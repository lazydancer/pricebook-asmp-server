const registerScanRoutes = require('./scans');
const registerWaystoneRoutes = require('./waystones');
const registerChunkRoutes = require('./chunks');
const registerItemRoutes = require('./items');

const MIN_MOD_VERSION = '1.0.0';

const registerRoutes = (app, ctx) => {
  app.get('/v1/mod-version', (_req, res) => {
    res.json({ min_version: MIN_MOD_VERSION });
  });

  registerScanRoutes(app, ctx);
  registerWaystoneRoutes(app, ctx);
  registerChunkRoutes(app, ctx);
  registerItemRoutes(app, ctx);
};

module.exports = {
  registerRoutes
};
