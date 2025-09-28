const dotenv = require('dotenv');
const { openDatabase } = require('../../lib/db');
const { SCHEMA_DDL } = require('../../lib/schema');
const { LATEST_SHOPS_DDL } = require('../../lib/latest-shops');
const { LATEST_WAYSTONES_DDL } = require('../../lib/latest-waystones');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);

const tableExists = (name) => {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`)
    .get(name);
  return !!row;
};

const columnType = (table, column) => {
  if (!tableExists(table)) {
    return null;
  }
  const infoRows = db.prepare(`PRAGMA table_info(${table})`).all();
  const columnInfo = infoRows.find((row) => row.name === column);
  return columnInfo ? String(columnInfo.type || '').toUpperCase() : null;
};

const toMillisExpr = (column) => `
  CASE
    WHEN ${column} IS NULL THEN NULL
    WHEN typeof(${column}) IN ('integer', 'real') THEN CAST(ROUND(${column}) AS INTEGER)
    ELSE CAST(ROUND((julianday(${column}) - 2440587.5) * 86400000) AS INTEGER)
  END
`;

const countRows = (table) => {
  if (!tableExists(table)) {
    return 0;
  }
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
};

try {
  const hasScans = tableExists('scans');
  const hasScanWaystones = tableExists('scan_waystones');
  const hasLatestShops = tableExists('latest_shops');
  const hasLatestWaystones = tableExists('latest_waystones');

  const columns = [
    { table: 'scans', column: 'scanned_at', exists: hasScans },
    { table: 'scan_waystones', column: 'observed_at', exists: hasScanWaystones },
    { table: 'latest_shops', column: 'observed_at', exists: hasLatestShops },
    { table: 'latest_waystones', column: 'observed_at', exists: hasLatestWaystones }
  ];

  const needsMigration = columns
    .filter(({ exists }) => exists)
    .some(({ table, column }) => columnType(table, column) !== 'INTEGER');

  if (!hasScans && !hasScanWaystones && !hasLatestShops && !hasLatestWaystones) {
    console.log('No relevant tables present; nothing to migrate.');
  } else if (!needsMigration) {
    console.log('Timestamp columns already use INTEGER values; nothing to migrate.');
  } else {
    console.log('Migrating timestamp columns to 64-bit millisecond integers...');

    db.pragma('foreign_keys = OFF');

    const migrate = db.transaction(() => {
      if (hasScans) {
        const originalCount = countRows('scans');

        db.exec(`
          CREATE TABLE scans_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id   TEXT    NOT NULL,
            dimension   TEXT    NOT NULL,
            chunk_x     INTEGER NOT NULL,
            chunk_z     INTEGER NOT NULL,
            scanned_at  INTEGER NOT NULL
          );
        `);

        db.exec(`
          INSERT INTO scans_new (id, sender_id, dimension, chunk_x, chunk_z, scanned_at)
          SELECT
            id,
            sender_id,
            dimension,
            chunk_x,
            chunk_z,
            ${toMillisExpr('scanned_at')}
          FROM scans;
        `);

        const migratedCount = countRows('scans_new');
        if (originalCount !== migratedCount) {
          throw new Error(`Mismatch migrating scans: expected ${originalCount}, inserted ${migratedCount}`);
        }
      }

      if (hasScanWaystones) {
        const originalCount = countRows('scan_waystones');

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
            observed_at   INTEGER NOT NULL,
            source        TEXT    NOT NULL,
            name          TEXT,
            owner         TEXT
          );
        `);

        db.exec(`
          INSERT INTO scan_waystones_new (
            id,
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
          )
          SELECT
            id,
            scan_id,
            dimension,
            pos_x,
            pos_y,
            pos_z,
            chunk_x,
            chunk_z,
            sender_id,
            ${toMillisExpr('observed_at')},
            source,
            name,
            owner
          FROM scan_waystones;
        `);

        const migratedCount = countRows('scan_waystones_new');
        if (originalCount !== migratedCount) {
          throw new Error(`Mismatch migrating scan_waystones: expected ${originalCount}, inserted ${migratedCount}`);
        }
      }

      if (hasLatestWaystones) {
        const originalCount = countRows('latest_waystones');

        db.exec(`
          CREATE TABLE latest_waystones_new (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            dimension      TEXT    NOT NULL,
            pos_x          INTEGER NOT NULL,
            pos_y          INTEGER NOT NULL,
            pos_z          INTEGER NOT NULL,
            chunk_x        INTEGER NOT NULL,
            chunk_z        INTEGER NOT NULL,
            name           TEXT,
            owner          TEXT,
            observed_at    INTEGER NOT NULL
          );
        `);

        db.exec(`
          INSERT INTO latest_waystones_new (
            id,
            dimension,
            pos_x,
            pos_y,
            pos_z,
            chunk_x,
            chunk_z,
            name,
            owner,
            observed_at
          )
          SELECT
            id,
            dimension,
            pos_x,
            pos_y,
            pos_z,
            chunk_x,
            chunk_z,
            name,
            owner,
            ${toMillisExpr('observed_at')}
          FROM latest_waystones;
        `);

        const migratedCount = countRows('latest_waystones_new');
        if (originalCount !== migratedCount) {
          throw new Error(`Mismatch migrating latest_waystones: expected ${originalCount}, inserted ${migratedCount}`);
        }
      }

      if (hasLatestShops) {
        const originalCount = countRows('latest_shops');

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
            observed_at    INTEGER NOT NULL,
            source_scan_id INTEGER NOT NULL,
            nearest_waystone_id INTEGER REFERENCES latest_waystones(id) ON DELETE SET NULL,
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
            nearest_waystone_id,
            nearest_waystone_distance_sq
          )
          SELECT
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
            ${toMillisExpr('observed_at')},
            source_scan_id,
            nearest_waystone_id,
            nearest_waystone_distance_sq
          FROM latest_shops;
        `);

        const migratedCount = countRows('latest_shops_new');
        if (originalCount !== migratedCount) {
          throw new Error(`Mismatch migrating latest_shops: expected ${originalCount}, inserted ${migratedCount}`);
        }
      }

      if (hasLatestShops) {
        db.exec('DROP TABLE latest_shops;');
      }
      if (hasLatestWaystones) {
        db.exec('DROP TABLE latest_waystones;');
      }
      if (hasScanWaystones) {
        db.exec('DROP TABLE scan_waystones;');
      }
      if (hasScans) {
        db.exec('DROP TABLE scans;');
      }

      if (hasLatestWaystones) {
        db.exec('ALTER TABLE latest_waystones_new RENAME TO latest_waystones;');
      }
      if (hasLatestShops) {
        db.exec('ALTER TABLE latest_shops_new RENAME TO latest_shops;');
      }
      if (hasScans) {
        db.exec('ALTER TABLE scans_new RENAME TO scans;');
      }
      if (hasScanWaystones) {
        db.exec('ALTER TABLE scan_waystones_new RENAME TO scan_waystones;');
      }
    });

    migrate();

    db.pragma('foreign_keys = ON');

    db.exec(SCHEMA_DDL);
    if (hasLatestShops) {
      db.exec(LATEST_SHOPS_DDL);
    }
    if (hasLatestWaystones) {
      db.exec(LATEST_WAYSTONES_DDL);
    }

    try {
      db.exec('VACUUM');
    } catch (vacuumError) {
      console.warn(`VACUUM skipped: ${vacuumError.message}`);
    }

    console.log(`Timestamp migration complete for ${DB_FILE}`);
  }
} catch (err) {
  console.error('Timestamp migration failed:', err.message);
  process.exitCode = 1;
} finally {
  try {
    db.pragma('foreign_keys = ON');
  } catch (_) {
    // ignore pragma errors during cleanup
  }
  db.close();
}
