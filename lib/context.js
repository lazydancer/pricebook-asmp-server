const { openDatabase } = require('./db');
const { SCHEMA_DDL } = require('./schema');
const { createLatestShopsAdapter } = require('./latest-shops');
const { createLatestWaystonesAdapter } = require('./latest-waystones');
const {
  encodeDimension,
  decodeDimension,
  encodeAction
} = require('./enums');

const createContext = (dbFile) => {
  const db = openDatabase(dbFile);
  db.exec(SCHEMA_DDL);
  db.pragma('foreign_keys = ON');

  const latestShops = createLatestShopsAdapter(db);
  const latestWaystones = createLatestWaystonesAdapter(db);

  const insertScanStmt = db.prepare(`
    INSERT INTO scans (sender_id, dimension, chunk_x, chunk_z, scanned_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertShopStmt = db.prepare(`
    INSERT INTO scan_shops (
      scan_id,
      owner,
      item,
      pos_x,
      pos_y,
      pos_z,
      dimension,
      price,
      amount,
      action,
      chunk_x,
      chunk_z
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertWaystoneStmt = db.prepare(`
    INSERT INTO scan_waystones (
      scan_id,
      dimension,
      pos_x,
      pos_y,
      pos_z,
      chunk_x,
      chunk_z,
      sender_id,
      observed_at,
      source,
      name,
      owner
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    FROM scan_shops
    WHERE scan_id = ?
  `);

  const waystoneCountForScanStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM scan_waystones
    WHERE scan_id = ?
  `);

  const everObservedShopsStmt = db.prepare(`
    SELECT COUNT(DISTINCT dimension || '|' || owner || '|' || item || '|' || pos_x || ',' || pos_y || ',' || pos_z) AS distinct_count
    FROM scan_shops
    WHERE dimension = ? AND chunk_x = ? AND chunk_z = ?
  `);

  const everObservedWaystonesStmt = db.prepare(`
    SELECT COUNT(DISTINCT dimension || '|' || pos_x || ',' || pos_y || ',' || pos_z) AS distinct_count
    FROM scan_waystones
    WHERE dimension = ? AND chunk_x = ? AND chunk_z = ?
  `);

  const activeWaystoneChunksStmt = db.prepare(`
    SELECT
      dimension,
    chunk_x,
    chunk_z,
    COUNT(*) AS active_waystones,
    MAX(observed_at) AS latest_observed_at
    FROM latest_waystones
    WHERE (@dimension IS NULL OR dimension = @dimension)
    GROUP BY dimension, chunk_x, chunk_z
  `);

  const insertScanTx = db.transaction((scanRow, shopRows, waystoneRows, options = {}) => {
    const effectiveShops = Array.isArray(shopRows) ? shopRows : [];
    const effectiveWaystones = Array.isArray(waystoneRows) ? waystoneRows : [];
    const shopPositions = effectiveShops.map((shop) => ({
      dimension: shop.dimension,
      posX: shop.posX,
      posY: shop.posY,
      posZ: shop.posZ
    }));

    const { lastInsertRowid: scanId } = insertScanStmt.run(
      scanRow.senderId,
      encodeDimension(scanRow.dimension),
      scanRow.chunkX,
      scanRow.chunkZ,
      scanRow.scannedAt
    );

    const persistedScan = { ...scanRow, scanId };

    for (const shop of effectiveShops) {
      insertShopStmt.run(
        scanId,
        shop.owner,
        shop.item,
        shop.posX,
        shop.posY,
        shop.posZ,
        encodeDimension(shop.dimension),
        shop.price,
        shop.amount,
        shop.action !== null && shop.action !== undefined ? encodeAction(shop.action) : null,
        shop.chunkX,
        shop.chunkZ
      );
    }

    for (const waystone of effectiveWaystones) {
      insertWaystoneStmt.run(
        scanId,
        encodeDimension(waystone.dimension),
        waystone.posX,
        waystone.posY,
        waystone.posZ,
        waystone.chunkX,
        waystone.chunkZ,
        scanRow.senderId,
        scanRow.scannedAt,
        waystone.source,
        waystone.name !== undefined ? waystone.name : null,
        waystone.owner !== undefined ? waystone.owner : null
      );
    }

    if (!options.skipShopReconcile) {
      latestShops.reconcileScan(persistedScan, effectiveShops);
    }

    let waystoneReconResult = { uiWaystones: [], prunedWaystones: [] };
    if (!options.skipWaystoneReconcile) {
      const result = latestWaystones.reconcileScan(persistedScan, effectiveWaystones);
      if (result) {
        waystoneReconResult = result;
      }
    }

    if (waystoneReconResult.uiWaystones.length > 0) {
      recomputeNearest('all');
    } else {
      if (shopPositions.length > 0) {
        recomputeNearest(shopPositions);
      }
      if (waystoneReconResult.prunedWaystones.length > 0) {
        recomputeNearest('stale');
      }
    }

    return scanId;
  });

  const queries = {
    chunkRows: (dimension) => {
      const rowset = getChunksStmt.all({ dimension: dimension ? encodeDimension(dimension) : null });
      return rowset.map((row) => ({
        ...row,
        dimension: decodeDimension(row.dimension)
      }));
    },
    latestScanIdForChunk: (dimension, chunkX, chunkZ) => {
      const row = latestScanIdStmt.get(encodeDimension(dimension), chunkX, chunkZ);
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
      const row = everObservedShopsStmt.get(encodeDimension(dimension), chunkX, chunkZ);
      return row ? row.distinct_count : 0;
    },
    distinctWaystonesForChunk: (dimension, chunkX, chunkZ) => {
      const row = everObservedWaystonesStmt.get(encodeDimension(dimension), chunkX, chunkZ);
      return row ? row.distinct_count : 0;
    },
    activeWaystoneChunks: (dimension) => activeWaystoneChunksStmt
      .all({ dimension: dimension ? encodeDimension(dimension) : null })
      .map((row) => ({
        ...row,
        dimension: decodeDimension(row.dimension)
      }))
  };

  const normalizePosition = (row) => ({
    dimension: row.dimension,
    posX: row.pos_x,
    posY: row.pos_y,
    posZ: row.pos_z
  });

  const uniquePositions = (positions) => {
    const map = new Map();
    for (const position of positions) {
      if (!position) continue;
      const key = `${position.dimension}|${position.posX}|${position.posY}|${position.posZ}`;
      if (!map.has(key)) {
        map.set(key, position);
      }
    }
    return Array.from(map.values());
  };

  const updateNearestWaystone = (position) => {
    const nearestResult = latestWaystones.nearestTo(position);

    if (nearestResult) {
      latestShops.setNearestWaystone(position, {
        id: nearestResult.id,
        name: nearestResult.name || null,
        posX: nearestResult.posX,
        posY: nearestResult.posY,
        posZ: nearestResult.posZ,
        distanceSq: nearestResult.distance_sq
      });
    } else {
      latestShops.setNearestWaystone(position, null);
    }
  };

  const recomputeNearest = (scope = 'all') => {
    let positions;

    if (Array.isArray(scope)) {
      positions = scope;
    } else if (scope === 'all') {
      positions = latestShops.listPositions().map(normalizePosition);
    } else if (scope === 'stale') {
      const rows = latestShops.listPositionsWithStaleNearest();
      if (!rows || rows.length === 0) {
        return;
      }
      positions = rows.map(normalizePosition);
    } else {
      throw new Error(`Unknown scope: ${scope}`);
    }

    const unique = uniquePositions(positions);
    for (const position of unique) {
      updateNearestWaystone(position);
    }
  };

  const close = () => {
    db.close();
  };

  return {
    db,
    latestShops,
    latestWaystones,
    insertScanTx,
    queries,
    close,
    recomputeNearest
  };
};

module.exports = {
  createContext
};
