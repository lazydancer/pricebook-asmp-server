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
