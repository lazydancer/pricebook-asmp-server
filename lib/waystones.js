/**
 * Waystones Adapter - Simplified Position-Based Architecture
 *
 * Position is the key. Changes in name/owner/source create new rows.
 * History preserved via is_current flag (no deletions).
 */

const { groupRowsByChunk } = require('./chunk-utils');

const keyForPosition = (dimension, posX, posY, posZ) =>
  `${dimension}|${posX}|${posY}|${posZ}`;

const stateKey = (name, owner, source) =>
  `${name ?? 'null'}|${owner ?? 'null'}|${source}`;

const createWaystonesAdapter = (db) => {
  // ============================================================================
  // Prepared statements
  // ============================================================================

  const selectCurrentAtPositionStmt = db.prepare(`
    SELECT id, name, owner, source, first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id
    FROM waystones
    WHERE dimension = ? AND pos_x = ? AND pos_y = ? AND pos_z = ? AND is_current = 1
  `);

  const insertWaystoneStmt = db.prepare(`
    INSERT INTO waystones (
      dimension, pos_x, pos_y, pos_z, name, owner, source,
      first_seen_at, first_seen_scan_id, last_seen_at, last_seen_scan_id, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const updateLastSeenStmt = db.prepare(`
    UPDATE waystones
    SET last_seen_at = ?, last_seen_scan_id = ?
    WHERE id = ?
  `);

  const markNotCurrentStmt = db.prepare(`
    UPDATE waystones
    SET is_current = 0
    WHERE id = ?
  `);

  const listWaystonesForChunkStmt = db.prepare(`
    SELECT id, dimension, pos_x, pos_y, pos_z, name, owner, source
    FROM waystones
    WHERE dimension = ?
      AND pos_x BETWEEN (? * 16) AND (? * 16 + 15)
      AND pos_z BETWEEN (? * 16) AND (? * 16 + 15)
      AND is_current = 1
  `);

  const nearestWaystoneStmt = db.prepare(`
    SELECT
      id,
      name,
      owner,
      dimension,
      pos_x AS posX,
      pos_y AS posY,
      pos_z AS posZ,
      ((pos_x - @posX) * (pos_x - @posX) +
       (pos_y - @posY) * (pos_y - @posY) +
       (pos_z - @posZ) * (pos_z - @posZ)) AS distance_sq
    FROM waystones
    WHERE dimension = @dimension
      AND is_current = 1
      AND name IS NOT NULL
      AND owner IS NOT NULL
    ORDER BY distance_sq ASC
    LIMIT 1
  `);

  // ============================================================================
  // Core reconciliation logic
  // ============================================================================

  /**
   * Reconcile a scan: update or create waystones based on observations
   * No deletions - only mark is_current = 0 for missing waystones
   */
  const reconcileScan = (scanRow, waystoneRows) => {
    const observations = Array.isArray(waystoneRows) ? waystoneRows : [];

    const uiWaystones = observations.filter(w => w.source === 'ui');
    const chunkWaystones = observations.filter(w => w.source === 'chunk');

    // Process UI waystones (metadata updates, no pruning)
    // Only process if they have name AND owner
    for (const waystone of uiWaystones) {
      // Skip waystones without name or owner
      if (!waystone.name || !waystone.owner) {
        continue;
      }

      const existing = selectCurrentAtPositionStmt.get(
        waystone.dimension,
        waystone.posX,
        waystone.posY,
        waystone.posZ
      );

      if (existing) {
        // Check if state changed
        const existingStateKey = stateKey(existing.name, existing.owner, existing.source);
        const newStateKey = stateKey(waystone.name, waystone.owner, waystone.source);

        if (existingStateKey === newStateKey) {
          // Same state, extend last_seen
          updateLastSeenStmt.run(scanRow.scannedAt, scanRow.scanId, existing.id);
        } else {
          // State changed, mark old as not current, insert new
          markNotCurrentStmt.run(existing.id);
          insertWaystoneStmt.run(
            waystone.dimension,
            waystone.posX,
            waystone.posY,
            waystone.posZ,
            waystone.name,
            waystone.owner,
            waystone.source,
            scanRow.scannedAt,
            scanRow.scanId,
            scanRow.scannedAt,
            scanRow.scanId
          );
        }
      } else {
        // New waystone
        insertWaystoneStmt.run(
          waystone.dimension,
          waystone.posX,
          waystone.posY,
          waystone.posZ,
          waystone.name,
          waystone.owner,
          waystone.source,
          scanRow.scannedAt,
          scanRow.scanId,
          scanRow.scannedAt,
          scanRow.scanId
        );
      }
    }

    const result = {
      uiWaystones: uiWaystones.map(w => ({
        dimension: w.dimension,
        posX: w.posX,
        posY: w.posY,
        posZ: w.posZ
      })),
      prunedWaystones: []
    };

    const hasChunkContext = (
      scanRow.dimension !== undefined &&
      scanRow.chunkX !== undefined &&
      scanRow.chunkZ !== undefined
    );

    if (!hasChunkContext && chunkWaystones.length === 0) {
      return result;
    }

    const waystonesByChunk = groupRowsByChunk(
      hasChunkContext ? {
        dimension: scanRow.dimension,
        chunkX: scanRow.chunkX,
        chunkZ: scanRow.chunkZ
      } : null,
      chunkWaystones,
      { bucketKey: 'waystones' }
    );

    if (waystonesByChunk.size === 0) {
      return result;
    }

    // Sync each chunk
    for (const chunk of waystonesByChunk.values()) {
      const pruned = syncChunkWaystones(chunk, scanRow);
      result.prunedWaystones.push(...pruned);
    }

    return result;
  };

  const syncChunkWaystones = (chunk, scanRow) => {
    // Get existing current waystones for this chunk
    const existingWaystones = listWaystonesForChunkStmt
      .all(chunk.dimension, chunk.chunkX, chunk.chunkX, chunk.chunkZ, chunk.chunkZ)
      .map(row => ({
        ...row,
        posKey: keyForPosition(row.dimension, row.pos_x, row.pos_y, row.pos_z)
      }));

    const existingByPosition = new Map(
      existingWaystones.map(waystone => [waystone.posKey, waystone])
    );

    const seenPositions = new Set();

    // Process observed waystones (chunk scans)
    // These update last_seen_at on existing waystones but don't create new ones
    for (const waystone of chunk.waystones) {
      const posKey = keyForPosition(waystone.dimension, waystone.posX, waystone.posY, waystone.posZ);

      const existing = existingByPosition.get(posKey);

      if (existing) {
        // Waystone exists - update last_seen_at regardless of name/owner
        // This confirms the waystone is still there even if we can't read its name
        seenPositions.add(posKey);
        updateLastSeenStmt.run(scanRow.scannedAt, scanRow.scanId, existing.id);
      } else {
        // Waystone doesn't exist in DB yet
        // Only create if it has name AND owner (from UI source)
        // Chunk scans without name/owner are ignored for new waystones
        if (waystone.name && waystone.owner) {
          seenPositions.add(posKey);
          insertWaystoneStmt.run(
            waystone.dimension,
            waystone.posX,
            waystone.posY,
            waystone.posZ,
            waystone.name,
            waystone.owner,
            waystone.source,
            scanRow.scannedAt,
            scanRow.scanId,
            scanRow.scannedAt,
            scanRow.scanId
          );
        }
        // If no name/owner, we simply don't track this waystone
      }
    }

    // Mark missing waystones as not current (preserve history, no deletion)
    const pruned = [];
    for (const [posKey, waystone] of existingByPosition) {
      if (!seenPositions.has(posKey)) {
        pruned.push({
          id: waystone.id,
          dimension: waystone.dimension,
          posX: waystone.pos_x,
          posY: waystone.pos_y,
          posZ: waystone.pos_z
        });
        markNotCurrentStmt.run(waystone.id);
      }
    }

    return pruned;
  };

  // ============================================================================
  // Query functions
  // ============================================================================

  return {
    reconcileScan,
    nearestTo: (params) => {
      const row = nearestWaystoneStmt.get(params);
      if (!row) {
        return null;
      }
      return row;
    }
  };
};

module.exports = {
  createWaystonesAdapter,
  keyForPosition,
  stateKey
};
