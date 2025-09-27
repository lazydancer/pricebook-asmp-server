const registerWaystoneRoutes = (app, ctx) => {
  app.post('/v1/scan-waystone', (req, res) => {
    try {
      const body = req.body || {};
      const senderId = body.senderId;
      if (!senderId) {
        return res.status(400).json({ ok: false, error: 'senderId is required' });
      }

      const position = Array.isArray(body.position) ? body.position : null;
      if (!position || position.length !== 3) {
        return res.status(400).json({ ok: false, error: 'position must be [x,y,z]' });
      }

      const posX = Number(position[0]);
      const posY = Number(position[1]);
      const posZ = Number(position[2]);
      if ([posX, posY, posZ].some((n) => Number.isNaN(n))) {
        return res.status(400).json({ ok: false, error: 'position must contain numbers' });
      }

      const dimension = body.dimension ? String(body.dimension) : null;
      if (!dimension) {
        return res.status(400).json({ ok: false, error: 'dimension is required' });
      }

      if (body.chunkX === undefined || body.chunkZ === undefined) {
        return res.status(400).json({ ok: false, error: 'chunkX and chunkZ are required' });
      }

      const chunkX = Math.trunc(Number(body.chunkX));
      const chunkZ = Math.trunc(Number(body.chunkZ));

      if (Number.isNaN(chunkX) || Number.isNaN(chunkZ)) {
        return res.status(400).json({ ok: false, error: 'chunkX and chunkZ must be numbers' });
      }

      const receivedAtIso = new Date().toISOString();

      if (body.name === undefined) {
        return res.status(400).json({ ok: false, error: 'name is required' });
      }

      if (body.owner === undefined) {
        return res.status(400).json({ ok: false, error: 'owner is required' });
      }

      const name = body.name === null ? null : String(body.name);
      const owner = body.owner === null ? null : String(body.owner);

      const waystoneRows = [
        {
          posX,
          posY,
          posZ,
          dimension,
          chunkX,
          chunkZ,
          name,
          owner,
          source: 'ui'
        }
      ];

      let scanId;
      try {
        scanId = ctx.insertScanTx(
          {
            senderId,
            dimension,
            chunkX,
            chunkZ,
            scannedAt: receivedAtIso
          },
          [],
          waystoneRows,
          { skipShopReconcile: true, skipWaystoneReconcile: true }
        );
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ ok: false, error: 'duplicate scan data' });
        }
        throw err;
      }

      ctx.latestWaystones.upsertObservation({
        dimension,
        posX,
        posY,
        posZ,
        chunkX,
        chunkZ,
        name,
        owner,
        observedAt: receivedAtIso
      });

      ctx.recomputeNearestForAllShops();

      return res.status(201).json({
        ok: true,
        scanId,
        dimension,
        chunkX,
        chunkZ,
        observedWaystones: 1,
        waystone: {
          position: [posX, posY, posZ],
          name: name !== undefined ? name : null,
          owner: owner !== undefined ? owner : null
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
};

module.exports = registerWaystoneRoutes;
