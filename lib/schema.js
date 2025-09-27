const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   TEXT    NOT NULL,
  dimension   TEXT    NOT NULL,
  chunk_x     INTEGER NOT NULL,
  chunk_z     INTEGER NOT NULL,
  scanned_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_shops (
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_shop
  ON scan_shops (scan_id, dimension, owner, item, pos_x, pos_y, pos_z);
CREATE INDEX IF NOT EXISTS idx_scans_chunk_time
  ON scans (dimension, chunk_x, chunk_z, scanned_at);
CREATE INDEX IF NOT EXISTS idx_shops_chunk_scan
  ON scan_shops (dimension, chunk_x, chunk_z, scan_id);
CREATE TABLE IF NOT EXISTS scan_waystones (
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_waystone
  ON scan_waystones (scan_id, dimension, pos_x, pos_y, pos_z);
CREATE INDEX IF NOT EXISTS idx_waystone_chunk_scan
  ON scan_waystones (dimension, chunk_x, chunk_z, scan_id);
`;

module.exports = {
  SCHEMA_DDL
};
