const chunkKey = (dimension, chunkX, chunkZ) => `${dimension}|${chunkX}|${chunkZ}`;

const registerChunkRoutes = (app, ctx) => {
  app.get('/v1/chunks', (req, res) => {
    try {
      const dimensionFilter = req.query.dimension ? String(req.query.dimension) : null;
      const staleMinutes = req.query.staleMinutes ? Number(req.query.staleMinutes) : null;
      const minEver = req.query.minEver ? Number(req.query.minEver) : null;
      const minEverWaystones = req.query.minEverWaystones ? Number(req.query.minEverWaystones) : null;
      const hasWaystones = req.query.hasWaystones ? String(req.query.hasWaystones).toLowerCase() : null;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 500;
      const offset = req.query.offset ? Number(req.query.offset) : 0;

      const numericParams = [staleMinutes, minEver, minEverWaystones, limit, offset].filter((v) => v !== null);
      if (numericParams.some((n) => Number.isNaN(n))) {
        return res.status(400).json({ ok: false, error: 'numeric query params must be valid numbers' });
      }

      const scanRows = ctx.queries.chunkRows(dimensionFilter);
      const waystoneActiveRows = ctx.queries.activeWaystoneChunks(dimensionFilter);
      const now = Date.now();

      const chunkMap = new Map();

      for (const row of scanRows) {
        const key = chunkKey(row.dimension, row.chunk_x, row.chunk_z);
        const latestScanId = ctx.queries.latestScanIdForChunk(row.dimension, row.chunk_x, row.chunk_z);
        const lastObservedCount = latestScanId ? ctx.queries.shopCountForScan(latestScanId) : 0;
        const lastObservedWaystones = latestScanId ? ctx.queries.waystoneCountForScan(latestScanId) : 0;
        const everObservedDistinct = ctx.queries.distinctShopsForChunk(row.dimension, row.chunk_x, row.chunk_z);
        const everObservedWaystones = ctx.queries.distinctWaystonesForChunk(row.dimension, row.chunk_x, row.chunk_z);
        const lastScannedAt = row.latest_scanned_at ? new Date(row.latest_scanned_at) : null;
        const minutesSinceLastScan = lastScannedAt ? Math.floor((now - lastScannedAt.getTime()) / 60000) : null;

        chunkMap.set(key, {
          dimension: row.dimension,
          chunkX: row.chunk_x,
          chunkZ: row.chunk_z,
          totalScans: row.total_scans,
          latestScannedAt: row.latest_scanned_at,
          minutesSinceLastScan,
          lastObservedCount,
          everObservedDistinct,
          lastObservedWaystones,
          everObservedWaystones
        });
      }

      for (const row of waystoneActiveRows) {
        const key = chunkKey(row.dimension, row.chunk_x, row.chunk_z);
        const everObservedWaystones = ctx.queries.distinctWaystonesForChunk(row.dimension, row.chunk_x, row.chunk_z);
        const existing = chunkMap.get(key);
        if (existing) {
          existing.lastObservedWaystones = Math.max(existing.lastObservedWaystones, row.active_waystones);
          existing.everObservedWaystones = Math.max(existing.everObservedWaystones, everObservedWaystones);
        } else {
          chunkMap.set(key, {
            dimension: row.dimension,
            chunkX: row.chunk_x,
            chunkZ: row.chunk_z,
            totalScans: 0,
            latestScannedAt: null,
            minutesSinceLastScan: null,
            lastObservedCount: 0,
            everObservedDistinct: 0,
            lastObservedWaystones: row.active_waystones,
            everObservedWaystones
          });
        }
      }

      const decorated = Array.from(chunkMap.values()).filter((chunk) => {
        if (staleMinutes !== null) {
          if (chunk.minutesSinceLastScan !== null && chunk.minutesSinceLastScan < staleMinutes) {
            return false;
          }
        }
        if (minEver !== null && chunk.everObservedDistinct < minEver) {
          return false;
        }
        if (minEverWaystones !== null && chunk.everObservedWaystones < minEverWaystones) {
          return false;
        }
        if (hasWaystones && ['true', '1'].includes(hasWaystones) && chunk.everObservedWaystones === 0) {
          return false;
        }
        if (hasWaystones && ['false', '0'].includes(hasWaystones) && chunk.everObservedWaystones > 0) {
          return false;
        }
        return true;
      });

      const sliced = decorated.slice(offset, offset + limit);
      return res.json({ chunks: sliced });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'failed to fetch chunks' });
    }
  });
};

module.exports = registerChunkRoutes;
