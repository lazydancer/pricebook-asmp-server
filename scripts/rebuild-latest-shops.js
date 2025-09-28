const dotenv = require('dotenv');
const { rebuildLatestShops, createLatestShopsAdapter } = require('../lib/latest-shops');
const { rebuildLatestWaystones, createLatestWaystonesAdapter} = require('../lib/latest-waystones');
const { openDatabase } = require('../lib/db');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);
db.pragma('foreign_keys = ON');

const shopInfo = rebuildLatestShops(db);
console.log('latest_shops rebuilt from historical scans:', shopInfo);

const waystoneInfo = rebuildLatestWaystones(db);
console.log('latest_waystones rebuilt from historical scans:', waystoneInfo);

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
          id: nearest.id,
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
