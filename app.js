const express = require('express');
const morgan = require('morgan');
const { registerRoutes } = require('./routes');

const createApp = (ctx) => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(morgan('tiny'));
  app.use((req, res, next) => {
    const debugPayload = {
      query: req.query,
      body: req.body
    };
    console.debug(`[req] ${req.method} ${req.originalUrl}`, debugPayload);
    next();
  });

  app.use((req, res, next) => {
    const rawValue = process.env.MAINTENANCE_MODE;
    const enabled = rawValue && ['1', 'true', 'yes', 'on'].includes(String(rawValue).toLowerCase());
    if (!enabled || req.path === '/healthz') {
      return next();
    }
    res.set('Retry-After', '120');
    console.warn(`[maintenance] ${req.method} ${req.originalUrl}`);
    return res.status(503).json({ ok: false, error: 'Service temporarily unavailable due to maintenance' });
  });

  registerRoutes(app, ctx);

  app.use((req, res) => {
    console.warn(`[404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ ok: false, error: 'Not found' });
  });
  return app;
};

module.exports = {
  createApp
};
