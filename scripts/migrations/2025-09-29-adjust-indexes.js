const dotenv = require('dotenv');
const { openDatabase } = require('../../lib/db');
const { SCHEMA_DDL } = require('../../lib/schema');
const { LATEST_SHOPS_DDL } = require('../../lib/latest-shops');
const { LATEST_WAYSTONES_DDL } = require('../../lib/latest-waystones');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const db = openDatabase(DB_FILE);

const indexExists = (name) => {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name);
  return !!row;
};

try {
  let changed = false;

  if (indexExists('idx_waystone_chunk_scan')) {
    console.log('Dropping idx_waystone_chunk_scan...');
    db.exec('DROP INDEX idx_waystone_chunk_scan;');
    changed = true;
  } else {
    console.log('idx_waystone_chunk_scan already absent; skipping drop.');
  }

  if (indexExists('idx_latest_shops_item_action_price')) {
    console.log('Dropping idx_latest_shops_item_action_price...');
    db.exec('DROP INDEX idx_latest_shops_item_action_price;');
    changed = true;
  } else {
    console.log('idx_latest_shops_item_action_price already absent; skipping drop.');
  }

  if (!indexExists('idx_latest_shops_item_action_price_ci')) {
    console.log('Creating idx_latest_shops_item_action_price_ci...');
    db.exec('CREATE INDEX idx_latest_shops_item_action_price_ci ON latest_shops (LOWER(item), action, price);');
    changed = true;
  } else {
    console.log('idx_latest_shops_item_action_price_ci already present; skipping create.');
  }

  if (changed) {
    // Ensure auxiliary DDL (e.g. IF NOT EXISTS clauses) are re-applied for future migrations
    db.exec(SCHEMA_DDL);
    db.exec(LATEST_SHOPS_DDL);
    db.exec(LATEST_WAYSTONES_DDL);
  }

  console.log(`Index migration complete for ${DB_FILE}`);
} catch (err) {
  console.error('Index migration failed:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}

