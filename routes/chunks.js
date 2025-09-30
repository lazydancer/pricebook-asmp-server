const { chunkKey } = require('../lib/chunk-utils');

const registerChunkRoutes = (app, ctx) => {
  app.get('/v1/chunks', (req, res) => {
    try {
      const scanRows = ctx.queries.chunkRows(null);
      const waystoneActiveRows = ctx.queries.activeWaystoneChunks(null);

      const chunkMap = new Map();

      for (const row of scanRows) {
        const key = chunkKey(row.dimension, row.chunk_x, row.chunk_z);
        chunkMap.set(key, {
          dimension: row.dimension,
          chunkX: row.chunk_x,
          chunkZ: row.chunk_z
        });
      }

      for (const row of waystoneActiveRows) {
        const key = chunkKey(row.dimension, row.chunk_x, row.chunk_z);
        const existing = chunkMap.get(key);
        if (existing) {
          continue;
        } else {
          chunkMap.set(key, {
            dimension: row.dimension,
            chunkX: row.chunk_x,
            chunkZ: row.chunk_z
          });
        }
      }

      const chunks = Array.from(chunkMap.values());
      return res.json({ chunks });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'failed to fetch chunks' });
    }
  });
};

module.exports = registerChunkRoutes;
