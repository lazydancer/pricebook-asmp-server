const { openDatabase } = require('./db');
const { SCHEMA_DDL } = require('./schema');
const { createShopsAdapter } = require('./shops');
const { createWaystonesAdapter } = require('./waystones');

const createContext = (dbFile) => {
  const db = openDatabase(dbFile);

  db.exec(SCHEMA_DDL);
  db.pragma('foreign_keys = ON');

  const shops = createShopsAdapter(db);
  const waystones = createWaystonesAdapter(db);

  const insertScanStmt = db.prepare(`
    INSERT INTO scans (sender_id, dimension, chunk_x, chunk_z, scanned_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getChunksStmt = db.prepare(`
    SELECT
      dimension,
      chunk_x,
      chunk_z,
      COUNT(*) AS total_scans,
      MAX(scanned_at) AS latest_scanned_at
    FROM scans
    WHERE (@dimension IS NULL OR dimension = @dimension)
    GROUP BY dimension, chunk_x, chunk_z
    ORDER BY latest_scanned_at DESC
  `);

  const latestScanIdStmt = db.prepare(`
    SELECT id
    FROM scans
    WHERE dimension = ? AND chunk_x = ? AND chunk_z = ?
    ORDER BY scanned_at DESC, id DESC
    LIMIT 1
  `);

  const shopCountForScanStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM shops
    WHERE first_seen_scan_id = ? AND removed_at IS NULL
  `);

  const waystoneCountForScanStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM waystones
    WHERE first_seen_scan_id = ? AND removed_at IS NULL
  `);

  const distinctShopsForChunkStmt = db.prepare(`
    SELECT COUNT(DISTINCT dimension || '|' || pos_x || '|' || pos_y || '|' || pos_z) AS distinct_count
    FROM shops
    WHERE dimension = ?
      AND pos_x BETWEEN (? * 16) AND (? * 16 + 15)
      AND pos_z BETWEEN (? * 16) AND (? * 16 + 15)
      AND removed_at IS NULL
  `);

  const distinctWaystonesForChunkStmt = db.prepare(`
    SELECT COUNT(DISTINCT dimension || '|' || pos_x || '|' || pos_y || '|' || pos_z) AS distinct_count
    FROM waystones
    WHERE dimension = ?
      AND pos_x BETWEEN (? * 16) AND (? * 16 + 15)
      AND pos_z BETWEEN (? * 16) AND (? * 16 + 15)
      AND removed_at IS NULL
  `);

  const activeWaystoneChunksStmt = db.prepare(`
    SELECT
      dimension,
      CAST((pos_x - (pos_x < 0) * 15) / 16 AS INTEGER) AS chunk_x,
      CAST((pos_z - (pos_z < 0) * 15) / 16 AS INTEGER) AS chunk_z,
      COUNT(*) AS active_waystones,
      MAX(last_seen_at) AS latest_observed_at
    FROM waystones
    WHERE (@dimension IS NULL OR dimension = @dimension)
      AND removed_at IS NULL
    GROUP BY dimension, chunk_x, chunk_z
  `);

  /**
   * Insert scan transaction
   */
  const insertScanTx = db.transaction((scanRow, shopRows, waystoneRows, options = {}) => {
    const effectiveShops = Array.isArray(shopRows) ? shopRows : [];
    const effectiveWaystones = Array.isArray(waystoneRows) ? waystoneRows : [];

    // Insert scan record
    const { lastInsertRowid: scanId } = insertScanStmt.run(
      scanRow.senderId,
      scanRow.dimension,
      scanRow.chunkX,
      scanRow.chunkZ,
      scanRow.scannedAt
    );

    const persistedScan = { ...scanRow, scanId };

    // Reconcile using simplified position-based adapters
    if (!options.skipShopReconcile) {
      shops.reconcileScan(persistedScan, effectiveShops);
    }

    if (!options.skipWaystoneReconcile) {
      waystones.reconcileScan(persistedScan, effectiveWaystones);
    }

    return scanId;
  });

  const queries = {
    chunkRows: (dimension) => {
      const rowset = getChunksStmt.all({ dimension: dimension ? dimension : null });
      return rowset.map((row) => ({
        ...row,
        dimension: row.dimension
      }));
    },
    latestScanIdForChunk: (dimension, chunkX, chunkZ) => {
      const row = latestScanIdStmt.get(dimension, chunkX, chunkZ);
      return row ? row.id : null;
    },
    shopCountForScan: (scanId) => {
      const row = shopCountForScanStmt.get(scanId);
      return row ? row.count : 0;
    },
    waystoneCountForScan: (scanId) => {
      const row = waystoneCountForScanStmt.get(scanId);
      return row ? row.count : 0;
    },
    distinctShopsForChunk: (dimension, chunkX, chunkZ) => {
      const row = distinctShopsForChunkStmt.get(
        dimension,
        chunkX, chunkX,
        chunkZ, chunkZ
      );
      return row ? row.distinct_count : 0;
    },
    distinctWaystonesForChunk: (dimension, chunkX, chunkZ) => {
      const row = distinctWaystonesForChunkStmt.get(
        dimension,
        chunkX, chunkX,
        chunkZ, chunkZ,
      );
      return row ? row.distinct_count : 0;
    },
    activeWaystoneChunks: (dimension) => activeWaystoneChunksStmt
      .all({ dimension: dimension ? dimension : null })
      .map((row) => ({
        ...row,
        dimension: row.dimension
      }))
  };

  const close = () => {
    db.close();
  };

  return {
    db,
    shops,
    waystones,
    insertScanTx,
    queries,
    close
  };
};

module.exports = {
  createContext
};