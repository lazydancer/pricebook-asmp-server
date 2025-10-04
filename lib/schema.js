const SCHEMA_DDL = `
-- Scans table
CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   TEXT    NOT NULL,
  dimension   TEXT    NOT NULL,
  chunk_x     INTEGER NOT NULL,
  chunk_z     INTEGER NOT NULL,
  scanned_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_chunk_time
  ON scans (dimension, chunk_x, chunk_z, scanned_at);

-- Shops (simplified: position-based with state history)
-- Each row is a state at a position. Position can have multiple states over time.
-- removed_at = NULL means this is the active state at this position.
-- removed_at = timestamp means this state was confirmed changed/removed at that time.
-- price, amount, action are NOT NULL - shops without these values are ignored.
CREATE TABLE IF NOT EXISTS shops (
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
CREATE INDEX IF NOT EXISTS idx_shops_position_removed
  ON shops (dimension, pos_x, pos_y, pos_z, removed_at);
CREATE INDEX IF NOT EXISTS idx_shops_item_action_removed
  ON shops (LOWER(item), action, removed_at, price) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shops_item_history
  ON shops (LOWER(item), last_seen_at DESC, removed_at);

-- Waystones (simplified: position-based with state history)
-- name and owner are NOT NULL - waystones without these are ignored.
-- Chunk scans that find waystones will update last_seen_at on existing waystones
-- but won't create new records without name/owner.
-- removed_at = NULL means this waystone is still active.
-- removed_at = timestamp means this waystone was confirmed changed/removed at that time.
CREATE TABLE IF NOT EXISTS waystones (
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
CREATE INDEX IF NOT EXISTS idx_waystones_position_removed
  ON waystones (dimension, pos_x, pos_y, pos_z, removed_at);
CREATE INDEX IF NOT EXISTS idx_waystones_removed_named
  ON waystones (dimension, removed_at) WHERE removed_at IS NULL AND name IS NOT NULL AND owner IS NOT NULL;
`;

module.exports = {
  SCHEMA_DDL
};