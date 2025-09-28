const keyForWaystone = (dimension, posX, posY, posZ) => `${dimension}|${posX}|${posY}|${posZ}`;
const chunkKey = (dimension, chunkX, chunkZ) => `${dimension}|${chunkX}|${chunkZ}`;

const LATEST_WAYSTONES_DDL = `
CREATE TABLE IF NOT EXISTS latest_waystones (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension      TEXT    NOT NULL,
  pos_x          INTEGER NOT NULL,
  pos_y          INTEGER NOT NULL,
  pos_z          INTEGER NOT NULL,
  chunk_x        INTEGER NOT NULL,
  chunk_z        INTEGER NOT NULL,
  name           TEXT,
  owner          TEXT,
  observed_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_latest_waystones_position
  ON latest_waystones (dimension, pos_x, pos_y, pos_z);
CREATE INDEX IF NOT EXISTS idx_latest_waystones_chunk
  ON latest_waystones (dimension, chunk_x, chunk_z);
`;

const createLatestWaystonesAdapter = (db) => {
  const selectLatestWaystonesForChunkStmt = db.prepare(`
    SELECT *
    FROM latest_waystones
    WHERE dimension = ? AND chunk_x = ? AND chunk_z = ?
  `);

  const insertLatestWaystoneStmt = db.prepare(`
    INSERT INTO latest_waystones (
      dimension,
      pos_x,
      pos_y,
      pos_z,
      chunk_x,
      chunk_z,
      name,
      owner,
      observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateLatestWaystoneStmt = db.prepare(`
    UPDATE latest_waystones
    SET name = ?,
        owner = ?,
        chunk_x = ?,
        chunk_z = ?,
        observed_at = ?
    WHERE id = ?
  `);

  const markLatestWaystoneSeenStmt = db.prepare(`
    UPDATE latest_waystones
    SET chunk_x = ?,
        chunk_z = ?,
        observed_at = ?
    WHERE id = ?
  `);

  const deleteLatestWaystoneStmt = db.prepare(`
    DELETE FROM latest_waystones WHERE id = ?
  `);

  const clearLatestWaystonesStmt = db.prepare('DELETE FROM latest_waystones');

  const nearestWaystoneStmt = db.prepare(`
    SELECT id, name, owner, pos_x AS posX, pos_y AS posY, pos_z AS posZ,
           ((pos_x - @posX)*(pos_x - @posX) + (pos_y - @posY)*(pos_y - @posY) + (pos_z - @posZ)*(pos_z - @posZ)) AS distance_sq
    FROM latest_waystones
    WHERE dimension = @dimension
    ORDER BY distance_sq ASC
    LIMIT 1
  `);

  const reconcileScan = (scanRow, waystoneRows) => {
    if (!Array.isArray(waystoneRows)) {
      waystoneRows = [];
    }

    const uiWaystones = waystoneRows.filter((w) => w.source === 'ui');
    const chunkWaystones = waystoneRows.filter((w) => w.source === 'chunk');

    const result = {
      uiWaystones: uiWaystones.map((w) => ({
        dimension: w.dimension,
        posX: w.posX,
        posY: w.posY,
        posZ: w.posZ
      })),
      prunedWaystones: []
    };

    for (const waystone of uiWaystones) {
      upsertObservation({
        dimension: waystone.dimension,
        posX: waystone.posX,
        posY: waystone.posY,
        posZ: waystone.posZ,
        chunkX: waystone.chunkX,
        chunkZ: waystone.chunkZ,
        name: waystone.name,
        owner: waystone.owner,
        observedAt: scanRow.scannedAt
      });
    }

    // Chunk scans prune unseen waystones for the involved chunks.
    if (uiWaystones.length > 0) {
      return result;
    }

    const combos = new Map();
    const waystonesByCombo = new Map();

    const registerCombo = (dimension, chunkX, chunkZ) => {
      const key = chunkKey(dimension, chunkX, chunkZ);
      if (!combos.has(key)) {
        combos.set(key, { dimension, chunkX, chunkZ });
      }
      if (!waystonesByCombo.has(key)) {
        waystonesByCombo.set(key, []);
      }
      return key;
    };

    registerCombo(scanRow.dimension, scanRow.chunkX, scanRow.chunkZ);

    for (const waystone of chunkWaystones) {
      const comboKeyValue = registerCombo(waystone.dimension, waystone.chunkX, waystone.chunkZ);
      waystonesByCombo.get(comboKeyValue).push(waystone);
    }

    for (const { dimension, chunkX, chunkZ } of combos.values()) {
      const existingRows = selectLatestWaystonesForChunkStmt.all(dimension, chunkX, chunkZ);
      const existingMap = new Map();
      for (const row of existingRows) {
        const existingKey = keyForWaystone(row.dimension, row.pos_x, row.pos_y, row.pos_z);
        existingMap.set(existingKey, row);
      }

      const relevantWaystones = waystonesByCombo.get(chunkKey(dimension, chunkX, chunkZ)) || [];

      for (const waystone of relevantWaystones) {
        const key = keyForWaystone(waystone.dimension, waystone.posX, waystone.posY, waystone.posZ);
        const existing = existingMap.get(key);
        if (existing) {
          markLatestWaystoneSeenStmt.run(
            waystone.chunkX,
            waystone.chunkZ,
            scanRow.scannedAt,
            existing.id
          );
          existingMap.delete(key);
        }
      }

      for (const leftover of existingMap.values()) {
        result.prunedWaystones.push({
          id: leftover.id,
          dimension,
          posX: leftover.pos_x,
          posY: leftover.pos_y,
          posZ: leftover.pos_z
        });
        deleteLatestWaystoneStmt.run(leftover.id);
      }
    }
    return result;
  };

  const upsertObservation = (observation) => {
    const existing = selectByPositionStmt.get(
      observation.dimension,
      observation.posX,
      observation.posY,
      observation.posZ
    );
    const name = observation.name !== undefined ? observation.name : existing ? existing.name : null;
    const owner = observation.owner !== undefined ? observation.owner : existing ? existing.owner : null;

    if (existing) {
      updateLatestWaystoneStmt.run(
        name,
        owner,
        observation.chunkX,
        observation.chunkZ,
        observation.observedAt,
        existing.id
      );
    } else {
      insertLatestWaystoneStmt.run(
        observation.dimension,
        observation.posX,
        observation.posY,
        observation.posZ,
        observation.chunkX,
        observation.chunkZ,
        name,
        owner,
        observation.observedAt
      );
    }
  };

  return {
    reconcileScan,
    upsertObservation,
    clearAll: () => clearLatestWaystonesStmt.run(),
    nearestTo: (params) => nearestWaystoneStmt.get(params)
  };
};

const rebuildLatestWaystones = (db) => {
  const adapter = createLatestWaystonesAdapter(db);

  const selectScansStmt = db.prepare(`
    SELECT id, dimension, chunk_x, chunk_z, scanned_at
    FROM scans
    ORDER BY scanned_at ASC, id ASC
  `);

  const selectWaystonesForScanStmt = db.prepare(`
    SELECT dimension, pos_x, pos_y, pos_z, chunk_x, chunk_z, source, name, owner
    FROM scan_waystones
    WHERE scan_id = ?
  `);

  const countLatestStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM latest_waystones
  `);

  let scansProcessed = 0;
  let waystoneObservationsProcessed = 0;

  const rebuildTx = db.transaction(() => {
    adapter.clearAll();
    const scans = selectScansStmt.all();
    scansProcessed = scans.length;

    for (const scan of scans) {
      const waystoneRows = selectWaystonesForScanStmt.all(scan.id).map((row) => {
        waystoneObservationsProcessed += 1;
        return {
          dimension: row.dimension,
          posX: row.pos_x,
          posY: row.pos_y,
          posZ: row.pos_z,
          chunkX: row.chunk_x,
          chunkZ: row.chunk_z,
          source: row.source,
          name: row.name !== undefined ? row.name : undefined,
          owner: row.owner !== undefined ? row.owner : undefined
        };
      });

      adapter.reconcileScan(
        {
          scanId: scan.id,
          dimension: scan.dimension,
          chunkX: scan.chunk_x,
          chunkZ: scan.chunk_z,
          scannedAt: scan.scanned_at
        },
        waystoneRows
      );
    }
  });

  rebuildTx();

  const latestCount = countLatestStmt.get().count;

  return {
    scansProcessed,
    waystoneObservationsProcessed,
    latestCount
  };
};

module.exports = {
  LATEST_WAYSTONES_DDL,
  createLatestWaystonesAdapter,
  rebuildLatestWaystones,
  keyForWaystone
};
