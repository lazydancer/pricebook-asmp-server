const dotenv = require('dotenv');
const { openDatabase } = require('../../lib/db');
const { SCHEMA_DDL } = require('../../lib/schema');
const { LATEST_SHOPS_DDL } = require('../../lib/latest-shops');
const { LATEST_WAYSTONES_DDL } = require('../../lib/latest-waystones');
const { encodeDimension, encodeAction } = require('../../lib/enums');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);

const tableExists = (name) => {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return !!row;
};

const columnType = (table, column) => {
  if (!tableExists(table)) {
    return null;
  }
  const infoRows = db.prepare(`PRAGMA table_info(${table})`).all();
  const match = infoRows.find((row) => row.name === column);
  if (!match) {
    return null;
  }
  return String(match.type || '').toUpperCase();
};

const renameTableIfNeeded = (table) => {
  if (!tableExists(table)) {
    return false;
  }
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old;`);
  return true;
};

const dropTableIfExists = (table) => {
  if (tableExists(table)) {
    db.exec(`DROP TABLE ${table};`);
  }
};

try {
  const requiresDimensionConversion = [
    { table: 'scans', column: 'dimension' },
    { table: 'scan_shops', column: 'dimension' },
    { table: 'scan_waystones', column: 'dimension' },
    { table: 'latest_shops', column: 'dimension' },
    { table: 'latest_waystones', column: 'dimension' }
  ].some(({ table, column }) => {
    const type = columnType(table, column);
    return type !== null && type !== 'INTEGER';
  });

  const requiresActionConversion = [
    { table: 'scan_shops', column: 'action' },
    { table: 'latest_shops', column: 'action' }
  ].some(({ table, column }) => {
    const type = columnType(table, column);
    return type !== null && type !== 'INTEGER';
  });

  if (!requiresDimensionConversion && !requiresActionConversion) {
    console.log('Dimension/action columns already stored as integers; nothing to migrate.');
  } else {
    console.log('Migrating dimension and action columns to compact integer representations...');

    db.pragma('foreign_keys = OFF');

    const renamed = [];

    const renameOrder = [
      'latest_shops',
      'latest_waystones',
      'scan_shops',
      'scan_waystones',
      'scans'
    ];

    for (const table of renameOrder) {
      if (renameTableIfNeeded(table)) {
        renamed.push(table);
      }
    }

    db.exec(SCHEMA_DDL);
    db.exec(LATEST_SHOPS_DDL);
    db.exec(LATEST_WAYSTONES_DDL);

    if (renamed.includes('scans')) {
      const insertStmt = db.prepare(`
        INSERT INTO scans (id, sender_id, dimension, chunk_x, chunk_z, scanned_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const selectStmt = db.prepare(`
        SELECT id, sender_id, dimension, chunk_x, chunk_z, scanned_at FROM scans_old
      `);
      const rows = selectStmt.all();
      const migrate = db.transaction(() => {
        for (const row of rows) {
          insertStmt.run(
            row.id,
            row.sender_id,
            encodeDimension(row.dimension),
            row.chunk_x,
            row.chunk_z,
            row.scanned_at
          );
        }
      });
      migrate();
      dropTableIfExists('scans_old');
    }

    if (renamed.includes('scan_shops')) {
      const insertStmt = db.prepare(`
        INSERT INTO scan_shops (
          id,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const selectStmt = db.prepare(`
        SELECT id, scan_id, owner, item, pos_x, pos_y, pos_z, dimension, price, amount, action, chunk_x, chunk_z
        FROM scan_shops_old
      `);
      const rows = selectStmt.all();
      const migrate = db.transaction(() => {
        for (const row of rows) {
          insertStmt.run(
            row.id,
            row.scan_id,
            row.owner,
            row.item,
            row.pos_x,
            row.pos_y,
            row.pos_z,
            encodeDimension(row.dimension),
            row.price,
            row.amount,
            row.action !== null && row.action !== undefined ? encodeAction(row.action) : null,
            row.chunk_x,
            row.chunk_z
          );
        }
      });
      migrate();
      dropTableIfExists('scan_shops_old');
    }

    if (renamed.includes('scan_waystones')) {
      const insertStmt = db.prepare(`
        INSERT INTO scan_waystones (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const selectStmt = db.prepare(`
        SELECT id, scan_id, dimension, pos_x, pos_y, pos_z, chunk_x, chunk_z, sender_id, observed_at, source, name, owner
        FROM scan_waystones_old
      `);
      const rows = selectStmt.all();
      const migrate = db.transaction(() => {
        for (const row of rows) {
          insertStmt.run(
            row.id,
            row.scan_id,
            encodeDimension(row.dimension),
            row.pos_x,
            row.pos_y,
            row.pos_z,
            row.chunk_x,
            row.chunk_z,
            row.sender_id,
            row.observed_at,
            row.source,
            row.name,
            row.owner
          );
        }
      });
      migrate();
      dropTableIfExists('scan_waystones_old');
    }

    if (renamed.includes('latest_waystones')) {
      const insertStmt = db.prepare(`
        INSERT INTO latest_waystones (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const selectStmt = db.prepare(`
        SELECT id, dimension, pos_x, pos_y, pos_z, chunk_x, chunk_z, name, owner, observed_at
        FROM latest_waystones_old
      `);
      const rows = selectStmt.all();
      const migrate = db.transaction(() => {
        for (const row of rows) {
          insertStmt.run(
            row.id,
            encodeDimension(row.dimension),
            row.pos_x,
            row.pos_y,
            row.pos_z,
            row.chunk_x,
            row.chunk_z,
            row.name,
            row.owner,
            row.observed_at
          );
        }
      });
      migrate();
      dropTableIfExists('latest_waystones_old');
    }

    if (renamed.includes('latest_shops')) {
      const insertStmt = db.prepare(`
        INSERT INTO latest_shops (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const selectStmt = db.prepare(`
        SELECT id, dimension, owner, item, pos_x, pos_y, pos_z, price, amount, action, chunk_x, chunk_z, observed_at, source_scan_id, nearest_waystone_id, nearest_waystone_distance_sq
        FROM latest_shops_old
      `);
      const rows = selectStmt.all();
      const migrate = db.transaction(() => {
        for (const row of rows) {
          insertStmt.run(
            row.id,
            encodeDimension(row.dimension),
            row.owner,
            row.item,
            row.pos_x,
            row.pos_y,
            row.pos_z,
            row.price,
            row.amount,
            row.action !== null && row.action !== undefined ? encodeAction(row.action) : null,
            row.chunk_x,
            row.chunk_z,
            row.observed_at,
            row.source_scan_id,
            row.nearest_waystone_id,
            row.nearest_waystone_distance_sq
          );
        }
      });
      migrate();
      dropTableIfExists('latest_shops_old');
    }

    db.exec(SCHEMA_DDL);
    db.exec(LATEST_SHOPS_DDL);
    db.exec(LATEST_WAYSTONES_DDL);

    try {
      db.exec('VACUUM');
    } catch (vacuumError) {
      console.warn(`VACUUM skipped: ${vacuumError.message}`);
    }

    db.pragma('foreign_keys = ON');

    console.log(`Dimension/action migration complete for ${DB_FILE}`);
  }
} catch (err) {
  console.error('Dimension/action migration failed:', err.message);
  process.exitCode = 1;
} finally {
  try {
    db.pragma('foreign_keys = ON');
  } catch (_) {
    // ignore
  }
  db.close();
}
