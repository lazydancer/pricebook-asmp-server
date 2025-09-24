const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const WAL_SUFFIXES = ['-wal', '-shm'];

const resolveDbPath = (dbFile) => path.resolve(dbFile);

const removeWalFiles = (dbFile) => {
  const resolved = resolveDbPath(dbFile);
  for (const suffix of WAL_SUFFIXES) {
    const candidate = `${resolved}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
};

const openDatabase = (dbFile) => {
  const resolved = resolveDbPath(dbFile);

  const attemptOpen = () => {
    const db = new Database(resolved);
    try {
      db.pragma('journal_mode = WAL');
      return db;
    } catch (pragmaError) {
      try {
        db.close();
      } catch (_) {
        // ignore close errors
      }
      throw pragmaError;
    }
  };

  try {
    return attemptOpen();
  } catch (err) {
    if (err && err.code === 'SQLITE_IOERR_SHORT_READ') {
      // Clean up any stale WAL/SHM files and try again.
      removeWalFiles(resolved);
      return attemptOpen();
    }
    throw err;
  }
};

module.exports = {
  openDatabase,
  removeWalFiles
};
