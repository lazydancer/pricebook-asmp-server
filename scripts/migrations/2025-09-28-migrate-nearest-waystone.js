const dotenv = require('dotenv');
const { openDatabase } = require('../../lib/db');
const { createContext } = require('../../lib/context');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);

typecheckTables();

function typecheckTables() {
  try {
    if (!tableExists('latest_shops')) {
      console.log('latest_shops table not found; nothing to migrate.');
      db.close();
      return;
    }

    const columns = db.prepare('PRAGMA table_info(latest_shops)').all();
    const hasLegacyColumns = columns.some((col) => ['nearest_waystone_name', 'nearest_waystone_x', 'nearest_waystone_y', 'nearest_waystone_z'].includes(col.name));
    const hasNearestId = columns.some((col) => col.name === 'nearest_waystone_id');

    if (!hasLegacyColumns && hasNearestId) {
      console.log('latest_shops schema already migrated.');
      db.close();
      return;
    }

    db.pragma('foreign_keys = OFF');

    const migrate = db.transaction(() => {
      console.log('Creating replacement latest_shops table...');
      db.exec(`
        CREATE TABLE latest_shops_new (
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
      `);

      console.log('Copying existing rows with nearest waystone references...');
      db.exec(`
        INSERT INTO latest_shops_new (
          id,
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
        )
        SELECT
          ls.id,
          ls.dimension,
          ls.owner,
          ls.item,
          ls.pos_x,
          ls.pos_y,
          ls.pos_z,
          ls.price,
          ls.amount,
          ls.action,
          ls.chunk_x,
          ls.chunk_z,
          ls.observed_at,
          ls.source_scan_id,
          lw.id,
          ls.nearest_waystone_distance_sq
        FROM latest_shops ls
        LEFT JOIN latest_waystones lw
          ON lw.dimension = ls.dimension
          AND lw.pos_x = ls.nearest_waystone_x
          AND lw.pos_y = ls.nearest_waystone_y
          AND lw.pos_z = ls.nearest_waystone_z;
      `);

      console.log('Dropping legacy latest_shops table...');
      db.exec('DROP TABLE latest_shops;');
      db.exec('ALTER TABLE latest_shops_new RENAME TO latest_shops;');

      console.log('Rebuilding latest_shops indexes...');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_latest_shops_position
          ON latest_shops (dimension, pos_x, pos_y, pos_z);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_latest_shops_item_action_price
          ON latest_shops (item, action, price);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_latest_shops_chunk
          ON latest_shops (dimension, chunk_x, chunk_z);
      `);
    });

    migrate();
    db.pragma('foreign_keys = ON');

    console.log('Ensuring latest schema definitions...');

    db.close();

    console.log('Recomputing nearest waystones for shops...');
    const ctx = createContext(DB_FILE);
    ctx.recomputeNearestForAllShops();
    ctx.close();

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    try {
      db.close();
    } catch (closeErr) {
      console.error('Failed to close database after error', closeErr);
    }
    process.exit(1);
  }
}

function tableExists(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return !!row;
}
