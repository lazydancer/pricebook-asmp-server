const { groupRowsByChunk } = require('./chunk-utils');

const keyForPosition = (dimension, posX, posY, posZ) =>
  `${dimension}|${posX}|${posY}|${posZ}`;

const stateKey = (owner, item, price, amount, action) =>
  `${owner}|${item}|${price ?? 'null'}|${amount ?? 'null'}|${action ?? 'null'}`;

const createShopsAdapter = (db) => {
  const insertShopStmt = db.prepare(`
    INSERT INTO shops (
      dimension, pos_x, pos_y, pos_z, owner, item, price, amount, action,
      first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const updateLastSeenStmt = db.prepare(`
    UPDATE shops
    SET last_seen_at = ?, last_seen_scan_id = ?
    WHERE id = ?
  `);

  const markNotCurrentStmt = db.prepare(`
    UPDATE shops
    SET is_current = 0
    WHERE id = ?
  `);

  const listShopsForChunkStmt = db.prepare(`
    SELECT id, dimension, pos_x, pos_y, pos_z, owner, item, price, amount, action
    FROM shops
    WHERE dimension = ?
      AND pos_x BETWEEN (? * 16) AND (? * 16 + 15)
      AND pos_z BETWEEN (? * 16) AND (? * 16 + 15)
      AND is_current = 1
  `);

  const createTopShopsStmt = (priceOrder) => db.prepare(`
    WITH ranked_shops AS (
      SELECT
        id,
        dimension,
        pos_x,
        pos_y,
        pos_z,
        owner,
        item,
        price,
        amount,
        action,
        last_seen_at as observed_at
      FROM shops
      WHERE LOWER(item) = LOWER(@item)
        AND action = @action
        AND price IS NOT NULL
        AND is_current = 1
      ORDER BY price ${priceOrder}, RANDOM()
      LIMIT @limit
    ),
    shop_waystones AS (
      SELECT
        rs.id as shop_id,
        w.id AS waystone_id,
        w.name AS waystone_name,
        w.owner AS waystone_owner,
        w.pos_x AS waystone_x,
        w.pos_y AS waystone_y,
        w.pos_z AS waystone_z,
        ((w.pos_x - rs.pos_x) * (w.pos_x - rs.pos_x) +
         (w.pos_y - rs.pos_y) * (w.pos_y - rs.pos_y) +
         (w.pos_z - rs.pos_z) * (w.pos_z - rs.pos_z)) AS distance_sq,
        ROW_NUMBER() OVER (PARTITION BY rs.id ORDER BY
          ((w.pos_x - rs.pos_x) * (w.pos_x - rs.pos_x) +
           (w.pos_y - rs.pos_y) * (w.pos_y - rs.pos_y) +
           (w.pos_z - rs.pos_z) * (w.pos_z - rs.pos_z)) ASC
        ) AS rn
      FROM ranked_shops rs
      LEFT JOIN waystones w ON w.dimension = rs.dimension AND w.is_current = 1
      WHERE w.name IS NOT NULL AND w.owner IS NOT NULL
    )
    SELECT
      rs.*,
      sw.waystone_id AS nearest_waystone_id,
      sw.waystone_name AS nearest_waystone_name,
      sw.waystone_owner AS nearest_waystone_owner,
      sw.waystone_x AS nearest_waystone_x,
      sw.waystone_y AS nearest_waystone_y,
      sw.waystone_z AS nearest_waystone_z,
      sw.distance_sq AS nearest_waystone_distance_sq
    FROM ranked_shops rs
    LEFT JOIN shop_waystones sw ON sw.shop_id = rs.id AND sw.rn = 1
  `);

  const topSellersStmt = createTopShopsStmt('ASC');
  const topBuyersStmt = createTopShopsStmt('DESC');

  const latestObservedStmt = db.prepare(`
    SELECT MAX(last_seen_at) AS latest_observed
    FROM shops
    WHERE LOWER(item) = LOWER(@item)
      AND is_current = 1
      AND (@dimension IS NULL OR dimension = @dimension)
  `);

  const listItemsStmt = db.prepare(`
    SELECT DISTINCT item
    FROM shops
    WHERE is_current = 1
    ORDER BY LOWER(item) ASC
  `);

  const listShopPositionsStmt = db.prepare(`
    SELECT DISTINCT dimension, pos_x, pos_y, pos_z
    FROM shops
    WHERE is_current = 1
  `);

  // ============================================================================
  // Core reconciliation logic
  // ============================================================================

  /**
   * Reconcile a scan: update or create shops based on observations
   * No deletions - only mark is_current = 0 for missing shops
   */
  const reconcileScan = (scanRow, shopRows) => {
    const observations = Array.isArray(shopRows) ? shopRows : [];
    const validShops = observations.filter((shop) => {
      if (shop.price === null || shop.price === undefined) return false;
      if (shop.amount === null || shop.amount === undefined) return false;
      if (shop.action === null || shop.action === undefined) return false;
      return true;
    });

    const chunksToSync = groupRowsByChunk(
      {
        dimension: scanRow.dimension,
        chunkX: scanRow.chunkX,
        chunkZ: scanRow.chunkZ
      },
      validShops,
      { bucketKey: 'shops' }
    );

    for (const chunk of chunksToSync.values()) {
      syncChunkShops(chunk.dimension, chunk.chunkX, chunk.chunkZ, chunk.shops, scanRow);
    }
  };

  const syncChunkShops = (dimension, chunkX, chunkZ, shops, scanRow) => {
    // Get existing current shops for this chunk
    const existingShops = listShopsForChunkStmt
      .all(dimension, chunkX, chunkX, chunkZ, chunkZ, )
      .map(row => ({
        ...row,
        posKey: keyForPosition(row.dimension, row.pos_x, row.pos_y, row.pos_z)
      }));

    const existingByPosition = new Map(
      existingShops.map(shop => [shop.posKey, shop])
    );

    const seenPositions = new Set();

    // Process observed shops
    for (const shop of shops) {
      // Skip shops with null price, amount, or action - these are incomplete
      if (shop.price === null || shop.price === undefined ||
          shop.amount === null || shop.amount === undefined ||
          shop.action === null || shop.action === undefined) {
        continue;
      }

      const posKey = keyForPosition(shop.dimension, shop.posX, shop.posY, shop.posZ);
      seenPositions.add(posKey);

      const existing = existingByPosition.get(posKey);

      if (existing) {
        // Check if state changed
        const existingStateKey = stateKey(
          existing.owner,
          existing.item,
          existing.price,
          existing.amount,
          existing.action
        );
        const newStateKey = stateKey(
          shop.owner,
          shop.item,
          shop.price,
          shop.amount,
          shop.action
        );

        if (existingStateKey === newStateKey) {
          // Same state, extend last_seen
          updateLastSeenStmt.run(scanRow.scannedAt, scanRow.scanId, existing.id);
        } else {
          // State changed, mark old as not current, insert new
          markNotCurrentStmt.run(existing.id);
          insertShopStmt.run(
            shop.dimension,
            shop.posX,
            shop.posY,
            shop.posZ,
            shop.owner,
            shop.item,
            shop.price,
            shop.amount,
            shop.action,
            scanRow.scannedAt,
            scanRow.scanId,
            scanRow.scannedAt,
            scanRow.scanId
          );
        }
      } else {
        // New shop at this position
        insertShopStmt.run(
          shop.dimension,
          shop.posX,
          shop.posY,
          shop.posZ,
          shop.owner,
          shop.item,
          shop.price,
          shop.amount,
          shop.action,
          scanRow.scannedAt,
          scanRow.scanId,
          scanRow.scannedAt,
          scanRow.scanId
        );
      }
    }

    // Mark missing shops as not current (preserve history, no deletion)
    for (const [posKey, shop] of existingByPosition) {
      if (!seenPositions.has(posKey)) {
        markNotCurrentStmt.run(shop.id);
      }
    }
  };

  // ============================================================================
  // Query functions
  // ============================================================================

  const decodeShopRow = (row) => ({
    ...row,
    action: row.action !== null && row.action !== undefined ? row.action : null
  });

  return {
    reconcileScan,
    topSellers: (params) => {
      const encoded = {
        ...params,
        action: 'sell'
      };
      return topSellersStmt.all(encoded).map(decodeShopRow);
    },
    topBuyers: (params) => {
      const encoded = {
        ...params,
        action: 'buy'
      };
      return topBuyersStmt.all(encoded).map(decodeShopRow);
    },
    latestObserved: (params) => {
      const encoded = {
        ...params,
        dimension: params.dimension ? params.dimension : null
      };
      return latestObservedStmt.get(encoded);
    },
    listItems: () => listItemsStmt.all(),
    listPositions: () => listShopPositionsStmt.all()
  };
};

module.exports = {
  createShopsAdapter,
  keyForPosition,
  stateKey
};
