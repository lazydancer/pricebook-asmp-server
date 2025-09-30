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
-- is_current = 1 means this is the active state at this position.
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
  is_current         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_shops_position_current
  ON shops (dimension, pos_x, pos_y, pos_z, is_current);
CREATE INDEX IF NOT EXISTS idx_shops_item_action_current
  ON shops (LOWER(item), action, is_current, price) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_shops_item_history
  ON shops (LOWER(item), last_seen_at DESC);

-- Waystones (simplified: position-based with state history)
-- name and owner are NOT NULL - waystones without these are ignored.
-- Chunk scans that find waystones will update last_seen_at on existing waystones
-- but won't create new records without name/owner.
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
  is_current         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_waystones_position_current
  ON waystones (dimension, pos_x, pos_y, pos_z, is_current);
CREATE INDEX IF NOT EXISTS idx_waystones_current_named
  ON waystones (dimension, is_current) WHERE is_current = 1 AND name IS NOT NULL AND owner IS NOT NULL;
`;

module.exports = {
  SCHEMA_DDL
};