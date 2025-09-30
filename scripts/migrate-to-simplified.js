#!/usr/bin/env node

/**
 * Migration: Scan-based → Simplified Position-based Architecture
 *
 * Converts from append-only scans to position-based state tracking.
 * Position is the key - changes in owner/item/price/amount create new rows.
 * History preserved with is_current flag (no deletions).
 *
 * Usage: node scripts/migrate-to-simplified.js [--dry-run]
 */

const { openDatabase } = require('../lib/db');
const { SCHEMA_DDL } = require('../lib/schema');
const { createWaystonesAdapter } = require('../lib/waystones');

const DB_FILE = process.env.DB_FILE || 'asmp.db';
const DRY_RUN = process.argv.includes('--dry-run');

// Decode helpers for legacy encoded values
const decodeDimension = (code) => {
  if (code === 0 || code === '0' || code === '0.0') return 'overworld';
  if (code === 1 || code === '1' || code === '1.0') return 'nether';
  if (code === 2 || code === '2' || code === '2.0') return 'end';
  return code;
};

const decodeAction = (code) => {
  if (code === null || code === undefined) return null;
  if (code === 0 || code === '0' || code === '0.0') return 'sell';
  if (code === 1 || code === '1' || code === '1.0') return 'buy';
  if (code === 2 || code === '2' || code === '2.0') return 'out of stock';
  return code;
};

const normalizeLegacyDimension = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    try {
      return decodeDimension(value);
    } catch (_) {
      return null;
    }
  }

  const str = String(value).trim().toLowerCase();
  if (str === '') {
    return null;
  }
  if (str === 'overworld' || str === 'the_overworld') return 'overworld';
  if (str === 'nether' || str === 'the_nether') return 'nether';
  if (str === 'end' || str === 'the_end') return 'end';

  // Try numeric-style labels e.g. '0'
  try {
    return decodeDimension(str);
  } catch (_) {
    return null;
  }
};

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

console.log(`Migration to Simplified Position-Based Architecture`);
console.log(`Database: ${DB_FILE}`);
console.log(`Dry run: ${DRY_RUN}`);
console.log('');

const db = openDatabase(DB_FILE);

// Check if already migrated
const hasSimplifiedSchema = () => {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('shops', 'waystones')
  `).get();

  if (result.count === 2) {
    // Check if it's the old schema or new schema
    const shopCols = db.prepare(`PRAGMA table_info(shops)`).all();
    const hasShopId = shopCols.some(col => col.name === 'shop_id');
    return !hasShopId; // If no shop_id column, it's the simplified schema
  }
  return false;
};

if (hasSimplifiedSchema()) {
  console.log('⚠️  Simplified schema already exists. Skipping migration.');
  db.close();
  process.exit(0);
}

console.log('Step 1: Analyzing existing data...');
const stats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM scan_shops) as total_shop_obs,
    (SELECT COUNT(*) FROM scan_waystones) as total_waystone_obs,
    (SELECT COUNT(DISTINCT dimension || '|' || pos_x || '|' || pos_y || '|' || pos_z) FROM scan_shops) as unique_positions
`).get();

console.log(`  Shop observations: ${stats.total_shop_obs}`);
console.log(`  Waystone observations: ${stats.total_waystone_obs}`);
console.log(`  Unique shop positions: ${stats.unique_positions}`);

if (DRY_RUN) {
  console.log('\n✓ Dry run complete. Run without --dry-run to execute migration.');
  db.close();
  process.exit(0);
}

console.log('\nStep 2: Creating simplified schema...');
db.exec(SCHEMA_DDL);
console.log('✓ Tables created');

console.log('\nStep 3: Migrating shops...');
const migrateShops = db.transaction(() => {
  const insertShop = db.prepare(`
    INSERT INTO shops (
      dimension, pos_x, pos_y, pos_z, owner, item, price, amount, action,
      first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const states = db.prepare(`
    SELECT
      ss.dimension, ss.pos_x, ss.pos_y, ss.pos_z, ss.owner, ss.item,
      ss.price, ss.amount, ss.action,
      MIN(ss.scan_id) as first_scan, MAX(ss.scan_id) as last_scan,
      MIN(s.scanned_at) as first_seen, MAX(s.scanned_at) as last_seen,
      (MAX(ss.scan_id) = (
        SELECT MAX(scan_id) FROM scan_shops
        WHERE dimension = ss.dimension
          AND pos_x = ss.pos_x
          AND pos_y = ss.pos_y
          AND pos_z = ss.pos_z
      )) as is_current
    FROM scan_shops ss
    JOIN scans s ON s.id = ss.scan_id
    GROUP BY
      ss.dimension, ss.pos_x, ss.pos_y, ss.pos_z,
      ss.owner, ss.item,
      COALESCE(ss.price, -1),
      COALESCE(ss.amount, -1),
      COALESCE(ss.action, '')
    ORDER BY ss.dimension, ss.pos_x, ss.pos_y, ss.pos_z, first_seen
  `).all();

  let inserted = 0;
  let skipped = 0;

  for (const state of states) {
    const dimension = decodeDimension(state.dimension);
    const action = decodeAction(state.action);

    if (state.price === null || state.price === undefined) {
      skipped += 1;
      continue;
    }

    if (state.amount === null || state.amount === undefined) {
      skipped += 1;
      continue;
    }

    if (!action) {
      skipped += 1;
      continue;
    }

    insertShop.run(
      dimension,
      state.pos_x,
      state.pos_y,
      state.pos_z,
      state.owner,
      state.item,
      state.price,
      state.amount,
      action,
      state.first_seen,
      state.first_scan,
      state.last_seen,
      state.last_scan,
      state.is_current ? 1 : 0
    );

    inserted += 1;
  }

  const summary = `  ✓ ${inserted} shop states${skipped ? ` (${skipped} skipped due to missing data)` : ''}`;
  console.log(summary);
});
migrateShops();

console.log('\nStep 4: Migrating waystones...');
const migrateWaystones = db.transaction(() => {
  // Replay historical scan data through the simplified adapter so that
  // waystone state (including is_current) matches the live reconciliation.
  const waystonesAdapter = createWaystonesAdapter(db);

  // Defensive cleanup in case this script is re-run after a partial attempt.
  db.prepare('DELETE FROM waystones').run();

  const scans = db.prepare(`
    SELECT id, sender_id, dimension, chunk_x, chunk_z, scanned_at
    FROM scans
    ORDER BY scanned_at ASC, id ASC
  `).all();

  const waystonesForScanStmt = db.prepare(`
    SELECT
      pos_x, pos_y, pos_z,
      dimension, chunk_x, chunk_z,
      source, name, owner
    FROM scan_waystones
    WHERE scan_id = ?
    ORDER BY id ASC
  `);

  const latestObservationForPositionStmt = db.prepare(`
    SELECT scan_id, observed_at, dimension
    FROM scan_waystones
    WHERE pos_x = ?
      AND pos_y = ?
      AND pos_z = ?
    ORDER BY observed_at DESC, scan_id DESC
  `);

  let processedScans = 0;
  let processedObservations = 0;
  let skippedScans = 0;

  for (const scan of scans) {
    const rawWaystones = waystonesForScanStmt.all(scan.id);

    // Normalize legacy data so we can feed it back into the adapter.
    const normalizedWaystones = rawWaystones.map((row) => ({
      posX: row.pos_x,
      posY: row.pos_y,
      posZ: row.pos_z,
      dimension: decodeDimension(row.dimension),
      chunkX: toNumberOrNull(row.chunk_x),
      chunkZ: toNumberOrNull(row.chunk_z),
      source: row.source,
      name: row.name || null,
      owner: row.owner || null
    }));

    let dimension = decodeDimension(scan.dimension);
    let chunkX = toNumberOrNull(scan.chunk_x);
    let chunkZ = toNumberOrNull(scan.chunk_z);

    if ((!dimension || chunkX === null || chunkZ === null) && normalizedWaystones.length > 0) {
      const fallback = normalizedWaystones[0];
      if (!dimension) dimension = fallback.dimension;
      if (chunkX === null) chunkX = fallback.chunkX;
      if (chunkZ === null) chunkZ = fallback.chunkZ;
    }

    // If we still cannot determine the chunk/dimension, there is nothing meaningful
    // to reconcile for this scan.
    if (!dimension || chunkX === null || chunkZ === null) {
      skippedScans += 1;
      continue;
    }

    let scannedAt = Number(scan.scanned_at);
    if (!Number.isFinite(scannedAt)) {
      scannedAt = Date.parse(scan.scanned_at);
    }
    if (!Number.isFinite(scannedAt)) {
      skippedScans += 1;
      continue;
    }

    waystonesAdapter.reconcileScan(
      {
        senderId: scan.sender_id,
        dimension,
        chunkX,
        chunkZ,
        scannedAt,
        scanId: scan.id
      },
      normalizedWaystones
    );

    processedScans += 1;
    processedObservations += normalizedWaystones.length;
  }

  // Use the legacy latest_waystones materialized view (when available) to
  // restore active flags so that the simplified schema faithfully reflects
  // pre-migration state.
  const latestWaystonesExists = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'latest_waystones'
  `).get().count === 1;

  if (latestWaystonesExists) {
    const latestRows = db.prepare(`
      SELECT dimension, pos_x, pos_y, pos_z, observed_at
      FROM latest_waystones
    `).all();

    const markCurrentStmt = db.prepare(`
      UPDATE waystones
      SET is_current = 1,
          last_seen_at = @lastSeenAt,
          last_seen_scan_id = @lastSeenScanId
      WHERE dimension = @dimension
        AND pos_x = @posX
        AND pos_y = @posY
        AND pos_z = @posZ
    `);

    let restoredActive = 0;

    for (const row of latestRows) {
      const canonicalDimension = normalizeLegacyDimension(row.dimension);
      if (!canonicalDimension) {
        continue;
      }

      const observations = latestObservationForPositionStmt.all(
        row.pos_x,
        row.pos_y,
        row.pos_z
      );

      const matchingObservation = observations.find((obs) => {
        const obsDimension = normalizeLegacyDimension(obs.dimension);
        return obsDimension && obsDimension === canonicalDimension;
      });

      if (!matchingObservation) {
        continue;
      }

      let lastSeenAt = toNumberOrNull(row.observed_at);
      if (!Number.isFinite(lastSeenAt)) {
        lastSeenAt = toNumberOrNull(matchingObservation.observed_at);
      }
      if (!Number.isFinite(lastSeenAt)) {
        const parsed = Date.parse(matchingObservation.observed_at);
        lastSeenAt = Number.isFinite(parsed) ? parsed : Date.now();
      }

      markCurrentStmt.run({
        dimension: canonicalDimension,
        posX: row.pos_x,
        posY: row.pos_y,
        posZ: row.pos_z,
        lastSeenAt,
        lastSeenScanId: matchingObservation.scan_id
      });

      restoredActive += 1;
    }

    console.log(`  ✓ Restored ${restoredActive} active waystones from latest_waystones`);
  }

  const totals = db.prepare('SELECT COUNT(*) AS count, SUM(is_current) AS active FROM waystones').get();

  console.log(`  ✓ Replayed ${processedScans} scans (${processedObservations} waystone observations)`);
  if (skippedScans > 0) {
    console.log(`  ⚠️  Skipped ${skippedScans} scans with incomplete data`);
  }
  console.log(`  ✓ Migrated ${totals.count} waystone states (${totals.active || 0} active)`);
});
migrateWaystones();

console.log('\nStep 5: Decoding scans table...');
db.exec(`
  UPDATE scans
  SET dimension = CASE
    WHEN dimension = '0' OR dimension = '0.0' THEN 'overworld'
    WHEN dimension = '1' OR dimension = '1.0' THEN 'nether'
    WHEN dimension = '2' OR dimension = '2.0' THEN 'end'
    ELSE dimension
  END
`);
console.log('  ✓ Decoded dimension values in scans table');

console.log('\nStep 6: Archiving old tables...');
db.exec('ALTER TABLE scan_shops RENAME TO scan_shops_archive');
db.exec('ALTER TABLE scan_waystones RENAME TO scan_waystones_archive');
console.log('  ✓ scan_shops → scan_shops_archive');
console.log('  ✓ scan_waystones → scan_waystones_archive');

console.log('\nStep 7: Computing storage savings...');
const oldSize = db.prepare(`
  SELECT ROUND(SUM(pgsize) / 1024.0 / 1024.0, 2) as mb
  FROM dbstat
  WHERE name IN ('scan_shops_archive', 'scan_waystones_archive')
`).get().mb;

const newSize = db.prepare(`
  SELECT ROUND(SUM(pgsize) / 1024.0 / 1024.0, 2) as mb
  FROM dbstat
  WHERE name IN ('shops', 'waystones')
`).get().mb;

console.log(`  Old: ${oldSize} MB`);
console.log(`  New: ${newSize} MB`);
console.log(`  Savings: ${(oldSize - newSize).toFixed(2)} MB (${((1 - newSize / oldSize) * 100).toFixed(1)}% reduction)`);

console.log('\nStep 8: Cleaning up legacy tables...');
db.exec(`
  DROP TABLE IF EXISTS scan_shops_archive;
  DROP TABLE IF EXISTS scan_waystones_archive;
  DROP TABLE IF EXISTS latest_shops;
  DROP TABLE IF EXISTS latest_waystones;
  VACUUM;
`);
console.log('  ✓ Dropped archive/materialized tables and vacuumed');

console.log('\n✅ Migration complete!');

db.close();
