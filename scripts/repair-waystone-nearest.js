const dotenv = require('dotenv');
const { openDatabase } = require('../lib/db');
const { createLatestWaystonesAdapter } = require('../lib/latest-waystones');
const { decodeDimension } = require('../lib/enums');
const { createContext } = require('../lib/context');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);
db.pragma('foreign_keys = ON');

const latestWaystones = createLatestWaystonesAdapter(db);

const uiWaystonesStmt = db.prepare(`
  SELECT dimension, pos_x, pos_y, pos_z, chunk_x, chunk_z, name, owner, MAX(observed_at) AS observed_at
  FROM scan_waystones
  WHERE source = 'ui'
  GROUP BY dimension, pos_x, pos_y, pos_z
`);

const uiRecords = uiWaystonesStmt.all();

const upsertTx = db.transaction(() => {
  for (const row of uiRecords) {
    latestWaystones.upsertObservation({
      dimension: decodeDimension(row.dimension),
      posX: row.pos_x,
      posY: row.pos_y,
      posZ: row.pos_z,
      chunkX: row.chunk_x,
      chunkZ: row.chunk_z,
      name: row.name,
      owner: row.owner,
      observedAt: row.observed_at
    });
  }
});

upsertTx();

const ctx = createContext(DB_FILE);
ctx.recomputeNearest('all');
ctx.close();

db.close();

console.log('Waystone repair completed.');
