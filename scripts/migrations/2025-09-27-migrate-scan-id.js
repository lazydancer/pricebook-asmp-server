const dotenv = require('dotenv');
const { openDatabase } = require('../../lib/db');
const { SCHEMA_DDL } = require('../../lib/schema');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);

const tableExists = (name) => {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
  return !!row;
};

try {
  let migrationNeeded = true;

  if (!tableExists('scans')) {
    console.log('No scans table found; nothing to migrate.');
    migrationNeeded = false;
  }

  let hasLegacyScanId = false;
  if (migrationNeeded) {
    const scansInfo = db.prepare('PRAGMA table_info(scans)').all();
    hasLegacyScanId = scansInfo.some((row) => row.name === 'scan_id');
    if (!hasLegacyScanId) {
      console.log('scans.scan_id not found; migration already applied.');
      migrationNeeded = false;
    }
  }

  if (migrationNeeded) {
    db.pragma('foreign_keys = OFF');

    const migrate = db.transaction(() => {
      // Capture mapping between legacy text scan_id and integer primary key.
      db.exec(`
        CREATE TEMP TABLE _scan_id_mapping (
          scan_id_text TEXT PRIMARY KEY,
          scan_row_id INTEGER NOT NULL
        );
      `);

      db.exec(`
        INSERT INTO _scan_id_mapping (scan_id_text, scan_row_id)
        SELECT scan_id, id FROM scans;
      `);

      const originalScanCount = db.prepare('SELECT COUNT(*) AS count FROM scans').get().count;
      const originalShopCount = db.prepare('SELECT COUNT(*) AS count FROM scan_shops').get().count;
      const originalWaystoneCount = db.prepare('SELECT COUNT(*) AS count FROM scan_waystones').get().count;
      const originalLatestShopCount = tableExists('latest_shops')
        ? db.prepare('SELECT COUNT(*) AS count FROM latest_shops').get().count
        : 0;

      db.exec(`
        CREATE TABLE scans_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id   TEXT    NOT NULL,
          dimension   TEXT    NOT NULL,
          chunk_x     INTEGER NOT NULL,
          chunk_z     INTEGER NOT NULL,
          scanned_at  TEXT    NOT NULL
        );
      `);

      db.exec(`
        INSERT INTO scans_new (id, sender_id, dimension, chunk_x, chunk_z, scanned_at)
        SELECT id, sender_id, dimension, chunk_x, chunk_z, scanned_at
        FROM scans;
      `);

      const migratedScanCount = db.prepare('SELECT COUNT(*) AS count FROM scans_new').get().count;
      if (originalScanCount !== migratedScanCount) {
        throw new Error(`Mismatch migrating scans: expected ${originalScanCount}, inserted ${migratedScanCount}`);
      }

      db.exec(`
        CREATE TABLE scan_shops_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_id     INTEGER NOT NULL REFERENCES scans(id),
          owner       TEXT    NOT NULL,
          item        TEXT    NOT NULL,
          pos_x       INTEGER NOT NULL,
          pos_y       INTEGER NOT NULL,
          pos_z       INTEGER NOT NULL,
          dimension   TEXT    NOT NULL,
          price       REAL,
          amount      INTEGER,
          action      TEXT,
          chunk_x     INTEGER NOT NULL,
          chunk_z     INTEGER NOT NULL
        );
      `);

      db.exec(`
        INSERT INTO scan_shops_new (
          id, scan_id, owner, item, pos_x, pos_y, pos_z, dimension, price, amount, action, chunk_x, chunk_z
        )
        SELECT
          ss.id,
          map.scan_row_id,
          ss.owner,
          ss.item,
          ss.pos_x,
          ss.pos_y,
          ss.pos_z,
          ss.dimension,
          ss.price,
          ss.amount,
          ss.action,
          ss.chunk_x,
          ss.chunk_z
        FROM scan_shops ss
        JOIN _scan_id_mapping map ON map.scan_id_text = ss.scan_id;
      `);

      const migratedShopCount = db.prepare('SELECT COUNT(*) AS count FROM scan_shops_new').get().count;
      if (originalShopCount !== migratedShopCount) {
        throw new Error(`Mismatch migrating scan_shops: expected ${originalShopCount}, inserted ${migratedShopCount}`);
      }

      db.exec(`
        CREATE TABLE scan_waystones_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_id       INTEGER NOT NULL REFERENCES scans(id),
          dimension     TEXT    NOT NULL,
          pos_x         INTEGER NOT NULL,
          pos_y         INTEGER NOT NULL,
          pos_z         INTEGER NOT NULL,
          chunk_x       INTEGER NOT NULL,
          chunk_z       INTEGER NOT NULL,
          sender_id     TEXT    NOT NULL,
          observed_at   TEXT    NOT NULL,
          source        TEXT    NOT NULL,
          name          TEXT,
          owner         TEXT
        );
      `);

      db.exec(`
        INSERT INTO scan_waystones_new (
          id, scan_id, dimension, pos_x, pos_y, pos_z, chunk_x, chunk_z, sender_id, observed_at, source, name, owner
        )
        SELECT
          sw.id,
          map.scan_row_id,
          sw.dimension,
          sw.pos_x,
          sw.pos_y,
          sw.pos_z,
          sw.chunk_x,
          sw.chunk_z,
          sw.sender_id,
          sw.observed_at,
          sw.source,
          sw.name,
          sw.owner
        FROM scan_waystones sw
        JOIN _scan_id_mapping map ON map.scan_id_text = sw.scan_id;
      `);

      const migratedWaystoneCount = db.prepare('SELECT COUNT(*) AS count FROM scan_waystones_new').get().count;
      if (originalWaystoneCount !== migratedWaystoneCount) {
        throw new Error(`Mismatch migrating scan_waystones: expected ${originalWaystoneCount}, inserted ${migratedWaystoneCount}`);
      }

      if (tableExists('latest_shops')) {
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
            nearest_waystone_name TEXT,
            nearest_waystone_x INTEGER,
            nearest_waystone_y INTEGER,
            nearest_waystone_z INTEGER,
            nearest_waystone_distance_sq INTEGER
          );
        `);

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
            nearest_waystone_name,
            nearest_waystone_x,
            nearest_waystone_y,
            nearest_waystone_z,
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
            map.scan_row_id,
            ls.nearest_waystone_name,
            ls.nearest_waystone_x,
            ls.nearest_waystone_y,
            ls.nearest_waystone_z,
            ls.nearest_waystone_distance_sq
          FROM latest_shops ls
          LEFT JOIN _scan_id_mapping map ON map.scan_id_text = ls.source_scan_id;
        `);

        const migratedLatestShopCount = db.prepare('SELECT COUNT(*) AS count FROM latest_shops_new').get().count;
        if (originalLatestShopCount !== migratedLatestShopCount) {
          throw new Error(`Mismatch migrating latest_shops: expected ${originalLatestShopCount}, inserted ${migratedLatestShopCount}`);
        }

        const unmatchedLatest = db.prepare('SELECT COUNT(*) AS count FROM latest_shops_new WHERE source_scan_id IS NULL').get().count;
        if (unmatchedLatest > 0) {
          throw new Error(`Migration aborted: ${unmatchedLatest} latest_shops rows could not be matched to an existing scan.`);
        }
      }

      db.exec(`
        DROP TABLE scan_shops;
        DROP TABLE scan_waystones;
        DROP TABLE scans;
      `);

      if (tableExists('latest_shops')) {
        db.exec('DROP TABLE latest_shops;');
      }

      db.exec(`
        ALTER TABLE scans_new RENAME TO scans;
        ALTER TABLE scan_shops_new RENAME TO scan_shops;
        ALTER TABLE scan_waystones_new RENAME TO scan_waystones;
      `);

      if (tableExists('latest_shops_new')) {
        db.exec('ALTER TABLE latest_shops_new RENAME TO latest_shops;');
      }

      db.exec('DROP TABLE _scan_id_mapping;');
    });

    migrate();

    db.pragma('foreign_keys = ON');

    // Re-create indexes and ensure auxiliary tables are up to date with the new schema.
    db.exec(SCHEMA_DDL);

    // Compact the database file after the bulk rewrite.
    db.exec('VACUUM');

    console.log(`Migration complete for ${DB_FILE}`);
  }
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  try {
    db.pragma('foreign_keys = ON');
  } catch (_) {
    // ignore pragma errors during cleanup
  }
  db.close();
}
