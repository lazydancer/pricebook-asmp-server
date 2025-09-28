const keyForLatestShop = (dimension, posX, posY, posZ) => `${dimension}|${posX}|${posY}|${posZ}`;
const chunkKey = (dimension, chunkX, chunkZ) => `${dimension}|${chunkX}|${chunkZ}`;

const LATEST_SHOPS_DDL = `
CREATE TABLE IF NOT EXISTS latest_shops (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension      TEXT    NOT NULL,
  owner          TEXT    NOT NULL,
  item           TEXT    NOT NULL,
  pos_x          INTEGER NOT NULL,
  pos_y          INTEGER NOT NULL,
  pos_z          INTEGER NOT NULL,
  price          REAL,
  amount         INTEGER,
  action         TEXT,
  chunk_x        INTEGER NOT NULL,
  chunk_z        INTEGER NOT NULL,
  observed_at    TEXT    NOT NULL,
  source_scan_id INTEGER NOT NULL,
  nearest_waystone_id INTEGER REFERENCES latest_waystones(id) ON DELETE SET NULL,
  nearest_waystone_distance_sq INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_latest_shops_position
  ON latest_shops (dimension, pos_x, pos_y, pos_z);
CREATE INDEX IF NOT EXISTS idx_latest_shops_item_action_price
  ON latest_shops (item, action, price);
CREATE INDEX IF NOT EXISTS idx_latest_shops_chunk
  ON latest_shops (dimension, chunk_x, chunk_z);
`;

const createLatestShopsAdapter = (db) => {
  const selectLatestShopsForChunkStmt = db.prepare(`
    SELECT id, dimension, owner, item, pos_x, pos_y, pos_z, price, amount, action
    FROM latest_shops
    WHERE dimension = ? AND chunk_x = ? AND chunk_z = ?
  `);

  const insertLatestShopStmt = db.prepare(`
    INSERT INTO latest_shops (
      dimension,
      owner,
      item,
      pos_x,
      pos_y,
      pos_z,
      price,
      amount,
      action,
      chunk_x,
      chunk_z,
      observed_at,
      source_scan_id,
      nearest_waystone_id,
      nearest_waystone_distance_sq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateLatestShopStmt = db.prepare(`
    UPDATE latest_shops
    SET owner = ?,
        item = ?,
        price = ?,
        amount = ?,
        action = ?,
        chunk_x = ?,
        chunk_z = ?,
        observed_at = ?,
        source_scan_id = ?
    WHERE id = ?
  `);

  const deleteLatestShopStmt = db.prepare(`
    DELETE FROM latest_shops WHERE id = ?
  `);

  const clearLatestShopsStmt = db.prepare('DELETE FROM latest_shops');

  const setNearestWaystoneStmt = db.prepare(`
    UPDATE latest_shops
    SET nearest_waystone_id = ?,
        nearest_waystone_distance_sq = ?
    WHERE dimension = ? AND pos_x = ? AND pos_y = ? AND pos_z = ?
  `);

  const listShopPositionsStmt = db.prepare(`
    SELECT dimension, pos_x, pos_y, pos_z
    FROM latest_shops
  `);

  const listShopPositionsWithStaleNearestStmt = db.prepare(`
    SELECT dimension, pos_x, pos_y, pos_z
    FROM latest_shops
    WHERE nearest_waystone_id IS NULL AND nearest_waystone_distance_sq IS NOT NULL
  `);

  const topLatestSellersStmt = db.prepare(`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY owner, price
               ORDER BY observed_at DESC, pos_x, pos_y, pos_z
             ) AS owner_price_rank
      FROM latest_shops
      WHERE LOWER(item) = LOWER(@item)
        AND action = 'sell'
        AND price IS NOT NULL
        AND (@dimension IS NULL OR dimension = @dimension)
    )
    SELECT r.owner,
           r.item,
           r.price,
           r.amount,
           r.action,
           r.pos_x,
           r.pos_y,
           r.pos_z,
           r.dimension,
           r.observed_at,
           lw.name AS nearest_waystone_name,
           lw.owner AS nearest_waystone_owner,
           lw.pos_x AS nearest_waystone_x,
           lw.pos_y AS nearest_waystone_y,
           lw.pos_z AS nearest_waystone_z,
           r.nearest_waystone_distance_sq
    FROM ranked r
    LEFT JOIN latest_waystones lw ON r.nearest_waystone_id = lw.id
    WHERE r.owner_price_rank = 1
    ORDER BY r.price ASC, RANDOM()
    LIMIT @limit
  `);

  const topLatestBuyersStmt = db.prepare(`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY owner, price
               ORDER BY observed_at DESC, pos_x, pos_y, pos_z
             ) AS owner_price_rank
      FROM latest_shops
      WHERE LOWER(item) = LOWER(@item)
        AND action = 'buy'
        AND price IS NOT NULL
        AND (@dimension IS NULL OR dimension = @dimension)
    )
    SELECT r.owner,
           r.item,
           r.price,
           r.amount,
           r.action,
           r.pos_x,
           r.pos_y,
           r.pos_z,
           r.dimension,
           r.observed_at,
           lw.name AS nearest_waystone_name,
           lw.owner AS nearest_waystone_owner,
           lw.pos_x AS nearest_waystone_x,
           lw.pos_y AS nearest_waystone_y,
           lw.pos_z AS nearest_waystone_z,
           r.nearest_waystone_distance_sq
    FROM ranked r
    LEFT JOIN latest_waystones lw ON r.nearest_waystone_id = lw.id
    WHERE r.owner_price_rank = 1
    ORDER BY r.price DESC, RANDOM()
    LIMIT @limit
  `);

  const latestItemObservedStmt = db.prepare(`
    SELECT MAX(observed_at) AS latest_observed
    FROM latest_shops
    WHERE LOWER(item) = LOWER(@item)
      AND (@dimension IS NULL OR dimension = @dimension)
  `);

  const listItemsStmt = db.prepare(`
    SELECT DISTINCT item
    FROM latest_shops
    WHERE item IS NOT NULL AND item != ''
    ORDER BY LOWER(item) ASC
  `);

  const latestObservedAnyStmt = db.prepare(`
    SELECT MAX(observed_at) AS latest_observed FROM latest_shops
  `);

  const reconcileScan = (scanRow, shopRows) => {
    const combos = new Map();
    const shopsByCombo = new Map();

    const registerCombo = (dimension, chunkX, chunkZ) => {
      const key = chunkKey(dimension, chunkX, chunkZ);
      if (!combos.has(key)) {
        combos.set(key, { dimension, chunkX, chunkZ });
      }
      if (!shopsByCombo.has(key)) {
        shopsByCombo.set(key, []);
      }
      return key;
    };

    registerCombo(scanRow.dimension, scanRow.chunkX, scanRow.chunkZ);

    for (const shop of shopRows) {
      const comboKeyValue = registerCombo(shop.dimension, shop.chunkX, shop.chunkZ);
      shopsByCombo.get(comboKeyValue).push(shop);
    }

    for (const { dimension, chunkX, chunkZ } of combos.values()) {
      const existingRows = selectLatestShopsForChunkStmt.all(dimension, chunkX, chunkZ);
      const existingMap = new Map();
      for (const row of existingRows) {
        existingMap.set(keyForLatestShop(row.dimension, row.pos_x, row.pos_y, row.pos_z), row);
      }

      const relevantShops = shopsByCombo.get(chunkKey(dimension, chunkX, chunkZ)) || [];

      for (const shop of relevantShops) {
        const key = keyForLatestShop(shop.dimension, shop.posX, shop.posY, shop.posZ);
        const normalizedAction = shop.action || null;
        const price = shop.price !== undefined ? shop.price : null;
        const amount = shop.amount !== undefined ? shop.amount : null;
        const existing = existingMap.get(key);

        if (existing) {
          updateLatestShopStmt.run(
            shop.owner,
            shop.item,
            price,
            amount,
            normalizedAction,
            shop.chunkX,
            shop.chunkZ,
            scanRow.scannedAt,
            scanRow.scanId,
            existing.id
          );
          existingMap.delete(key);
        } else {
          insertLatestShopStmt.run(
            shop.dimension,
            shop.owner,
            shop.item,
            shop.posX,
            shop.posY,
            shop.posZ,
            price,
            amount,
            normalizedAction,
            shop.chunkX,
            shop.chunkZ,
            scanRow.scannedAt,
            scanRow.scanId,
            null
          );
        }
      }

      for (const leftover of existingMap.values()) {
        deleteLatestShopStmt.run(leftover.id);
      }
    }
  };

  const setNearestWaystone = (position, nearest) => {
    if (nearest) {
      setNearestWaystoneStmt.run(
        nearest.id !== undefined ? nearest.id : null,
        nearest.distanceSq !== undefined ? nearest.distanceSq : null,
        position.dimension,
        position.posX,
        position.posY,
        position.posZ
      );
    } else {
      setNearestWaystoneStmt.run(
        null,
        null,
        position.dimension,
        position.posX,
        position.posY,
        position.posZ
      );
    }
  };

  return {
    reconcileScan,
    topSellers: (params) => topLatestSellersStmt.all(params),
    topBuyers: (params) => topLatestBuyersStmt.all(params),
    latestObserved: (params) => latestItemObservedStmt.get(params),
    listItems: () => listItemsStmt.all(),
    latestObservedAny: () => latestObservedAnyStmt.get(),
    clearAll: () => clearLatestShopsStmt.run(),
    setNearestWaystone,
    listPositions: () => listShopPositionsStmt.all(),
    listPositionsWithStaleNearest: () => listShopPositionsWithStaleNearestStmt.all()
  };
};

const rebuildLatestShops = (db) => {
  const adapter = createLatestShopsAdapter(db);
  const selectScansStmt = db.prepare(`
    SELECT id, dimension, chunk_x, chunk_z, scanned_at
    FROM scans
    ORDER BY scanned_at ASC, id ASC
  `);

  const selectShopsForScanStmt = db.prepare(`
    SELECT owner, item, pos_x, pos_y, pos_z, dimension, price, amount, action, chunk_x, chunk_z
    FROM scan_shops
    WHERE scan_id = ?
  `);

  const countLatestStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM latest_shops
  `);

  let scansProcessed = 0;
  let shopObservationsProcessed = 0;

  const rebuildTx = db.transaction(() => {
    adapter.clearAll();
    const scans = selectScansStmt.all();
    scansProcessed = scans.length;

    for (const scan of scans) {
      const shopRows = selectShopsForScanStmt.all(scan.id).map((shop) => {
        shopObservationsProcessed += 1;
        return {
          owner: shop.owner,
          item: shop.item,
          posX: shop.pos_x,
          posY: shop.pos_y,
          posZ: shop.pos_z,
          dimension: shop.dimension,
          price: shop.price,
          amount: shop.amount,
          action: shop.action,
          chunkX: shop.chunk_x,
          chunkZ: shop.chunk_z
        };
      });

      adapter.reconcileScan(
        {
          scanId: scan.id,
          dimension: scan.dimension,
          chunkX: scan.chunk_x,
          chunkZ: scan.chunk_z,
          scannedAt: scan.scanned_at
        },
        shopRows
      );
    }
  });

  rebuildTx();

  const latestCount = countLatestStmt.get().count;

  return {
    scansProcessed,
    shopObservationsProcessed,
    latestCount
  };
};

module.exports = {
  LATEST_SHOPS_DDL,
  createLatestShopsAdapter,
  rebuildLatestShops
};
