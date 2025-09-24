const registerScanRoutes = require('./scans');
const registerWaystoneRoutes = require('./waystones');
const registerChunkRoutes = require('./chunks');
const registerItemRoutes = require('./items');

const registerRoutes = (app, ctx) => {
  registerScanRoutes(app, ctx);
  registerWaystoneRoutes(app, ctx);
  registerChunkRoutes(app, ctx);
  registerItemRoutes(app, ctx);
};

module.exports = {
  registerRoutes
};
