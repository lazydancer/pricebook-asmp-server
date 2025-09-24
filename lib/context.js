const { openDatabase } = require('./db');
const { SCHEMA_DDL } = require('./schema');
const { ensureLatestSchema, createLatestShopsAdapter } = require('./latest-shops');
const { ensureWaystoneLatestSchema, createLatestWaystonesAdapter } = require('./latest-waystones');

const createContext = (dbFile) => {
  const db = openDatabase(dbFile);
  db.exec(SCHEMA_DDL);
  ensureLatestSchema(db);
  ensureWaystoneLatestSchema(db);
  db.pragma('foreign_keys = ON');

  const latestShops = createLatestShopsAdapter(db);
  const latestWaystones = createLatestWaystonesAdapter(db);

  const insertScanStmt = db.prepare(`
    INSERT INTO scans (scan_id, sender_id, dimension, chunk_x, chunk_z, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?)
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
    SELECT scan_id
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

    insertScanStmt.run(
      scanRow.scanId,
      scanRow.senderId,
      scanRow.dimension,
      scanRow.chunkX,
      scanRow.chunkZ,
      scanRow.scannedAt
    );

    for (const shop of effectiveShops) {
      insertShopStmt.run(
        scanRow.scanId,
        shop.owner,
        shop.item,
        shop.posX,
        shop.posY,
        shop.posZ,
        shop.dimension,
        shop.price,
        shop.amount,
        shop.action,
        shop.chunkX,
        shop.chunkZ
      );
    }

   for (const waystone of effectiveWaystones) {
     insertWaystoneStmt.run(
       scanRow.scanId,
       waystone.dimension,
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
      latestShops.reconcileScan(scanRow, effectiveShops);
    }

    let waystoneReconResult = { uiWaystones: [], prunedWaystones: [] };
    if (!options.skipWaystoneReconcile) {
      const result = latestWaystones.reconcileScan(scanRow, effectiveWaystones);
      if (result) {
        waystoneReconResult = result;
      }
    }

    if (waystoneReconResult.uiWaystones.length > 0) {
      recomputeNearestForAllShops();
    } else {
      if (shopPositions.length > 0) {
        recomputeNearestForPositions(shopPositions);
      }
      if (waystoneReconResult.prunedWaystones.length > 0) {
        recomputeNearestForWaystoneCoords(waystoneReconResult.prunedWaystones);
      }
    }
  });

  const queries = {
    chunkRows: (dimension) => getChunksStmt.all({ dimension }),
    latestScanIdForChunk: (dimension, chunkX, chunkZ) => {
      const row = latestScanIdStmt.get(dimension, chunkX, chunkZ);
      return row ? row.scan_id : null;
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
      const row = everObservedShopsStmt.get(dimension, chunkX, chunkZ);
      return row ? row.distinct_count : 0;
    },
    distinctWaystonesForChunk: (dimension, chunkX, chunkZ) => {
      const row = everObservedWaystonesStmt.get(dimension, chunkX, chunkZ);
      return row ? row.distinct_count : 0;
    },
    activeWaystoneChunks: (dimension) => activeWaystoneChunksStmt.all({ dimension })
  };

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

  const recomputeNearestForPositions = (positions) => {
    const unique = uniquePositions(positions);
    for (const position of unique) {
      const nearestResult = latestWaystones.nearestTo({
        dimension: position.dimension,
        posX: position.posX,
        posY: position.posY,
        posZ: position.posZ
      });
      if (nearestResult) {
        const nearest = {
          name: nearestResult.name || null,
          posX: nearestResult.posX,
          posY: nearestResult.posY,
          posZ: nearestResult.posZ,
          distanceSq: nearestResult.distance_sq
        };
        latestShops.setNearestWaystone(position, {
          name: nearest.name,
          posX: nearest.posX,
          posY: nearest.posY,
          posZ: nearest.posZ,
          distanceSq: nearest.distanceSq
        });
      } else {
        latestShops.setNearestWaystone(position, null);
      }
    }
  };

  const recomputeNearestForAllShops = () => {
    const positions = latestShops.listPositions().map((row) => ({
      dimension: row.dimension,
      posX: row.pos_x,
      posY: row.pos_y,
      posZ: row.pos_z
    }));
    recomputeNearestForPositions(positions);
  };

  const recomputeNearestForWaystoneCoords = (coordsArray) => {
    const positions = [];
    for (const coords of coordsArray) {
      const rows = latestShops.listPositionsByNearest(coords.posX, coords.posY, coords.posZ);
      for (const row of rows) {
        positions.push({
          dimension: row.dimension,
          posX: row.pos_x,
          posY: row.pos_y,
          posZ: row.pos_z
        });
      }
    }
    recomputeNearestForPositions(positions);
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
    recomputeNearestForAllShops,
    recomputeNearestForPositions,
    recomputeNearestForWaystoneCoords
  };
};

module.exports = {
  createContext
};
