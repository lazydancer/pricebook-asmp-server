const dotenv = require('dotenv');
const express = require('express');
const { createContext } = require('./lib/context');
const { createApp } = require('./app');

dotenv.config();

const PORT = parseInt(process.env.PORT, 10) || 49876;
const DB_FILE = process.env.DB_FILE || 'asmp.db';
const maintenanceMode = process.env.MAINTENANCE_MODE === 'true';

if (maintenanceMode) {
  console.warn('[maintenance] MAINTENANCE_MODE enabled, serving maintenance responses only');
  const maintenanceApp = express();

  maintenanceApp.get('/healthz', (req, res) => {
    res.json({ ok: false, maintenance: true });
  });

  maintenanceApp.use((req, res) => {
    res.set('Retry-After', '120');
    console.warn(`[maintenance] ${req.method} ${req.originalUrl}`);
    res.status(503).json({ ok: false, error: 'Service temporarily unavailable due to maintenance' });
  });

  const maintenanceServer = maintenanceApp.listen(PORT, () => {
    console.log(`[maintenance] Listening on port ${PORT}`);
  });

  const maintenanceShutdown = () => {
    maintenanceServer.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', maintenanceShutdown);
  process.on('SIGTERM', maintenanceShutdown);
} else {
  const ctx = createContext(DB_FILE);
  try {
    ctx.recomputeNearest('all');
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
}
