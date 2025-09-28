const dotenv = require('dotenv');
const { LATEST_SHOPS_DDL, rebuildLatestShops, createLatestShopsAdapter } = require('../lib/latest-shops');
const { LATEST_WAYSTONES_DDL, rebuildLatestWaystones, createLatestWaystonesAdapter } = require('../lib/latest-waystones');
const { openDatabase } = require('../lib/db');
const { SCHEMA_DDL } = require('../lib/schema');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);
db.exec(SCHEMA_DDL);
db.exec(LATEST_SHOPS_DDL);
db.exec(LATEST_WAYSTONES_DDL);
db.pragma('foreign_keys = ON');

const insertScan = db.prepare(`
  INSERT INTO scans (sender_id, dimension, chunk_x, chunk_z, scanned_at)
  VALUES (?, ?, ?, ?, ?)
`);

const insertShop = db.prepare(`
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

const insertWaystone = db.prepare(`
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

const now = new Date();
const firstScanTime = now.toISOString();
const secondScanTime = new Date(now.getTime() + 20 * 60 * 1000).toISOString();

let firstScanId;
let secondScanId;

const seedTx = db.transaction(() => {
  ({ lastInsertRowid: firstScanId } = insertScan.run('seed-script', 'overworld', 7, 35, firstScanTime));
  insertShop.run(
    firstScanId,
    'Alice',
    'Diamond',
    120,
    64,
    560,
    'overworld',
    32.0,
    3,
    'out of stock',
    7,
    35
  );

  insertWaystone.run(
    firstScanId,
    'overworld',
    128,
    70,
    560,
    8,
    35,
    'seed-script',
    firstScanTime,
    'chunk',
    null,
    null
  );

  ({ lastInsertRowid: secondScanId } = insertScan.run('seed-script', 'overworld', 7, 35, secondScanTime));
  insertWaystone.run(
    secondScanId,
    'overworld',
    128,
    70,
    560,
    8,
    35,
    'seed-script',
    secondScanTime,
    'ui',
    'Spawn Hub',
    'Server Admin'
  );
});

seedTx();

console.log('Seed data inserted:');
console.log(`  Non-empty scan ${firstScanId} at ${firstScanTime}`);
console.log(`  Empty scan ${secondScanId} at ${secondScanTime}`);

const rebuildShopInfo = rebuildLatestShops(db);
console.log('latest_shops rebuilt:', rebuildShopInfo);

const rebuildWaystoneInfo = rebuildLatestWaystones(db);
console.log('latest_waystones rebuilt:', rebuildWaystoneInfo);

const latestShops = createLatestShopsAdapter(db);
const latestWaystones = createLatestWaystonesAdapter(db);

const positions = latestShops.listPositions().map((row) => ({
  dimension: row.dimension,
  posX: row.pos_x,
  posY: row.pos_y,
  posZ: row.pos_z
}));

for (const position of positions) {
  const nearest = latestWaystones.nearestTo(position);
  latestShops.setNearestWaystone(
    position,
    nearest
      ? {
          name: nearest.name || null,
          posX: nearest.posX,
          posY: nearest.posY,
          posZ: nearest.posZ,
          distanceSq: nearest.distance_sq
        }
      : null
  );
}

console.log('nearest waystones refreshed for latest_shops');

db.close();
