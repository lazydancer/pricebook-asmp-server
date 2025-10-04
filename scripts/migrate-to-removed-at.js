const { openDatabase } = require('../lib/db');

const DB_FILE = process.argv[2] || 'asmp.db';

console.log(`Migrating database to removed_at: ${DB_FILE}`);

const db = openDatabase(DB_FILE);

try {
  db.exec('BEGIN TRANSACTION');

  // ============================================================================
  // Step 1: Add removed_at column
  // ============================================================================
  console.log('\n[Step 1/3] Adding removed_at column...');

  try {
    db.exec('ALTER TABLE shops ADD COLUMN removed_at INTEGER');
    console.log('✓ Added removed_at column to shops');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('✓ removed_at column already exists in shops');
    } else {
      throw err;
    }
  }

  try {
    db.exec('ALTER TABLE waystones ADD COLUMN removed_at INTEGER');
    console.log('✓ Added removed_at column to waystones');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('✓ removed_at column already exists in waystones');
    } else {
      throw err;
    }
  }

  // Create new indexes
  console.log('Creating new indexes...');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shops_position_removed
      ON shops (dimension, pos_x, pos_y, pos_z, removed_at);
    CREATE INDEX IF NOT EXISTS idx_shops_item_action_removed
      ON shops (LOWER(item), action, removed_at, price) WHERE removed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_waystones_position_removed
      ON waystones (dimension, pos_x, pos_y, pos_z, removed_at);
    CREATE INDEX IF NOT EXISTS idx_waystones_removed_named
      ON waystones (dimension, removed_at) WHERE removed_at IS NULL AND name IS NOT NULL AND owner IS NOT NULL;
  `);
  console.log('✓ Created new indexes');

  // ============================================================================
  // Step 2: Populate removed_at values
  // ============================================================================
  console.log('\n[Step 2/3] Populating removed_at values...');

  // For shops: set removed_at to next record's first_seen_at
  const shopsUpdated1 = db.prepare(`
    UPDATE shops
    SET removed_at = (
      SELECT next_shop.first_seen_at
      FROM shops AS next_shop
      WHERE next_shop.dimension = shops.dimension
        AND next_shop.pos_x = shops.pos_x
        AND next_shop.pos_y = shops.pos_y
        AND next_shop.pos_z = shops.pos_z
        AND next_shop.first_seen_at > shops.first_seen_at
      ORDER BY next_shop.first_seen_at ASC
      LIMIT 1
    )
    WHERE is_current = 0 AND removed_at IS NULL
  `).run();
  console.log(`✓ Set removed_at from next record for ${shopsUpdated1.changes} shops`);

  // For shops with no replacement: use last_seen_at
  const shopsUpdated2 = db.prepare(`
    UPDATE shops
    SET removed_at = last_seen_at
    WHERE is_current = 0 AND removed_at IS NULL
  `).run();
  console.log(`✓ Set removed_at to last_seen_at for ${shopsUpdated2.changes} shops with no replacement`);

  // For waystones: set removed_at to next record's first_seen_at
  const waystonesUpdated1 = db.prepare(`
    UPDATE waystones
    SET removed_at = (
      SELECT next_waystone.first_seen_at
      FROM waystones AS next_waystone
      WHERE next_waystone.dimension = waystones.dimension
        AND next_waystone.pos_x = waystones.pos_x
        AND next_waystone.pos_y = waystones.pos_y
        AND next_waystone.pos_z = waystones.pos_z
        AND next_waystone.first_seen_at > waystones.first_seen_at
      ORDER BY next_waystone.first_seen_at ASC
      LIMIT 1
    )
    WHERE is_current = 0 AND removed_at IS NULL
  `).run();
  console.log(`✓ Set removed_at from next record for ${waystonesUpdated1.changes} waystones`);

  // For waystones with no replacement: use last_seen_at
  const waystonesUpdated2 = db.prepare(`
    UPDATE waystones
    SET removed_at = last_seen_at
    WHERE is_current = 0 AND removed_at IS NULL
  `).run();
  console.log(`✓ Set removed_at to last_seen_at for ${waystonesUpdated2.changes} waystones with no replacement`);

  // ============================================================================
  // Step 3: Drop is_current column
  // ============================================================================
  console.log('\n[Step 3/3] Dropping is_current column...');

  // Drop old indexes
  db.exec(`
    DROP INDEX IF EXISTS idx_shops_position_current;
    DROP INDEX IF EXISTS idx_shops_item_action_current;
    DROP INDEX IF EXISTS idx_waystones_position_current;
    DROP INDEX IF EXISTS idx_waystones_current_named;
  `);
  console.log('✓ Dropped old is_current indexes');

  // Recreate shops table without is_current
  console.log('Recreating shops table without is_current...');
  db.exec(`
    CREATE TABLE shops_new (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension          TEXT    NOT NULL,
      pos_x              INTEGER NOT NULL,
      pos_y              INTEGER NOT NULL,
      pos_z              INTEGER NOT NULL,
      owner              TEXT    NOT NULL,
      item               TEXT    NOT NULL,
      price              REAL    NOT NULL,
      amount             INTEGER NOT NULL,
      action             TEXT    NOT NULL,
      first_seen_at      INTEGER NOT NULL,
      first_seen_scan_id INTEGER NOT NULL REFERENCES scans(id),
      last_seen_at       INTEGER NOT NULL,
      last_seen_scan_id  INTEGER NOT NULL REFERENCES scans(id),
      removed_at         INTEGER
    );

    INSERT INTO shops_new SELECT
      id, dimension, pos_x, pos_y, pos_z, owner, item, price, amount, action,
      first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id, removed_at
    FROM shops;

    DROP TABLE shops;
    ALTER TABLE shops_new RENAME TO shops;

    CREATE INDEX idx_shops_position_removed
      ON shops (dimension, pos_x, pos_y, pos_z, removed_at);
    CREATE INDEX idx_shops_item_action_removed
      ON shops (LOWER(item), action, removed_at, price) WHERE removed_at IS NULL;
    CREATE INDEX idx_shops_item_history
      ON shops (LOWER(item), last_seen_at DESC, removed_at);
  `);
  console.log('✓ Recreated shops table');

  // Recreate waystones table without is_current
  console.log('Recreating waystones table without is_current...');
  db.exec(`
    CREATE TABLE waystones_new (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension          TEXT    NOT NULL,
      pos_x              INTEGER NOT NULL,
      pos_y              INTEGER NOT NULL,
      pos_z              INTEGER NOT NULL,
      name               TEXT    NOT NULL,
      owner              TEXT    NOT NULL,
      source             TEXT    NOT NULL,
      first_seen_at      INTEGER NOT NULL,
      first_seen_scan_id INTEGER NOT NULL REFERENCES scans(id),
      last_seen_at       INTEGER NOT NULL,
      last_seen_scan_id  INTEGER NOT NULL REFERENCES scans(id),
      removed_at         INTEGER
    );

    INSERT INTO waystones_new SELECT
      id, dimension, pos_x, pos_y, pos_z, name, owner, source,
      first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id, removed_at
    FROM waystones;

    DROP TABLE waystones;
    ALTER TABLE waystones_new RENAME TO waystones;

    CREATE INDEX idx_waystones_position_removed
      ON waystones (dimension, pos_x, pos_y, pos_z, removed_at);
    CREATE INDEX idx_waystones_removed_named
      ON waystones (dimension, removed_at) WHERE removed_at IS NULL AND name IS NOT NULL AND owner IS NOT NULL;
  `);
  console.log('✓ Recreated waystones table');

  // ============================================================================
  // Summary
  // ============================================================================
  const shopsCurrent = db.prepare('SELECT COUNT(*) as count FROM shops WHERE removed_at IS NULL').get();
  const shopsRemoved = db.prepare('SELECT COUNT(*) as count FROM shops WHERE removed_at IS NOT NULL').get();
  const waystonesCurrent = db.prepare('SELECT COUNT(*) as count FROM waystones WHERE removed_at IS NULL').get();
  const waystonesRemoved = db.prepare('SELECT COUNT(*) as count FROM waystones WHERE removed_at IS NOT NULL').get();

  console.log('\n=== Migration Summary ===');
  console.log(`Shops - Current: ${shopsCurrent.count}, Removed: ${shopsRemoved.count}`);
  console.log(`Waystones - Current: ${waystonesCurrent.count}, Removed: ${waystonesRemoved.count}`);

  db.exec('COMMIT');
  console.log('\n✓ Migration completed successfully!');
} catch (err) {
  console.error('\n✗ Migration failed:', err);
  db.exec('ROLLBACK');
  process.exit(1);
} finally {
  db.close();
}
