const dotenv = require('dotenv');
const { createContext } = require('./lib/context');
const { createApp } = require('./app');

dotenv.config();

if (process.env.MAINTENANCE_MODE === 'true') {
  console.warn('[maintenance] MAINTENANCE_MODE enabled, exiting before startup');
  process.exit(0);
}

const PORT = parseInt(process.env.PORT, 10) || 49876;
const DB_FILE = process.env.DB_FILE || 'asmp.db';

const ctx = createContext(DB_FILE);
try {
  ctx.recomputeNearestForAllShops();
} catch (err) {
  console.error('Failed to recompute nearest waystones on startup', err);
}
const app = createApp(ctx);

const server = app.listen(PORT, () => {
  console.log(`Scan service listening on port ${PORT}`);
});

const shutdown = () => {
  try {
    server.close(() => {
      try {
        ctx.close();
      } catch (err) {
        console.error('Error closing database', err);
      }
      process.exit(0);
    });
  } catch (err) {
    console.error('Error during shutdown', err);
    try {
      ctx.close();
    } catch (dbErr) {
      console.error('Error closing database', dbErr);
    }
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
