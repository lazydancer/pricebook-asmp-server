const { deriveChunkFromPosition } = require('../lib/chunk-utils');

const ALLOWED_ACTIONS = new Set(['buy', 'sell', 'out of stock']);

const validateAction = (value, index) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`shops[${index}].action must be a string when provided`);
  }

  if (!ALLOWED_ACTIONS.has(value)) {
    throw new Error(`shops[${index}].action must be one of: buy, sell, out of stock`);
  }

  return value;
};

const normalizeShops = (shopsInput, dimension, chunkX, chunkZ) => {
  const shopsArray = Array.isArray(shopsInput) ? shopsInput : [];
  return shopsArray.map((shop, index) => {
    if (!shop || typeof shop !== 'object') {
      throw new Error(`shops[${index}] must be an object`);
    }

    const owner = shop.owner;
    const item = shop.item;
    const position = Array.isArray(shop.position) ? shop.position : null;

    if (!owner || !item) {
      throw new Error(`shops[${index}] requires owner and item`);
    }

    if (!position || position.length !== 3) {
      throw new Error(`shops[${index}] must include position [x,y,z]`);
    }

    const posX = Number(position[0]);
    const posY = Number(position[1]);
    const posZ = Number(position[2]);

    if ([posX, posY, posZ].some((n) => Number.isNaN(n))) {
      throw new Error(`shops[${index}] position must contain numbers`);
    }

    const shopDimension = shop.dimension || dimension;
    if (!shopDimension) {
      throw new Error(`shops[${index}] missing dimension; provide scan dimension or per-shop dimension`);
    }

    const price = shop.price !== undefined ? Number(shop.price) : null;
    if (price !== null && Number.isNaN(price)) {
      throw new Error(`shops[${index}].price must be numeric when provided`);
    }

    const amount = shop.amount !== undefined ? Math.trunc(Number(shop.amount)) : null;
    if (amount !== null && Number.isNaN(amount)) {
      throw new Error(`shops[${index}].amount must be numeric when provided`);
    }

    return {
      owner,
      item,
      posX,
      posY,
      posZ,
      dimension: shopDimension,
      price,
      amount,
      action: validateAction(shop.action, index),
      position
    };
  });
};

const normalizeWaystones = (waystonesInput, dimension) => {
  const waystonesArray = Array.isArray(waystonesInput) ? waystonesInput : [];
  return waystonesArray.map((waystone, index) => {
    if (!waystone || typeof waystone !== 'object') {
      throw new Error(`waystones[${index}] must be an object`);
    }

    const position = Array.isArray(waystone.position) ? waystone.position : null;
    if (!position || position.length !== 3) {
      throw new Error(`waystones[${index}] must include position [x,y,z]`);
    }

    const posX = Number(position[0]);
    const posY = Number(position[1]);
    const posZ = Number(position[2]);

    if ([posX, posY, posZ].some((n) => Number.isNaN(n))) {
      throw new Error(`waystones[${index}] position must contain numbers`);
    }

    const waystoneDimension = waystone.dimension || dimension;
    if (!waystoneDimension) {
      throw new Error(`waystones[${index}] missing dimension; provide scan dimension or per-waystone dimension`);
    }

    const chunk = deriveChunkFromPosition([posX, posY, posZ]);

    return {
      posX,
      posY,
      posZ,
      dimension: waystoneDimension,
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      source: 'chunk'
    };
  });
};

const registerScanRoutes = (app, ctx) => {
  app.post('/v1/scan', (req, res) => {
    try {
      const body = req.body || {};
      const senderId = body.senderId;
      if (!senderId) {
        return res.status(400).json({ ok: false, error: 'senderId is required' });
      }

      let dimension = body.dimension || null;
      let chunkX = body.chunkX !== undefined ? Math.trunc(Number(body.chunkX)) : null;
      let chunkZ = body.chunkZ !== undefined ? Math.trunc(Number(body.chunkZ)) : null;

      const scannedAtIso = new Date().toISOString();

      const normalizedShops = normalizeShops(body.shops, dimension, chunkX, chunkZ);
      const normalizedWaystones = normalizeWaystones(body.waystones, dimension);

      if ((!dimension || chunkX === null || chunkZ === null) && normalizedShops.length > 0) {
        const first = normalizedShops[0];
        if (!dimension) {
          dimension = first.dimension;
        }
        if (chunkX === null || chunkZ === null) {
          const derived = deriveChunkFromPosition(first.position);
          if (chunkX === null) chunkX = derived.chunkX;
          if (chunkZ === null) chunkZ = derived.chunkZ;
        }
      }

      if ((!dimension || chunkX === null || chunkZ === null) && normalizedWaystones.length > 0) {
        const first = normalizedWaystones[0];
        if (!dimension) {
          dimension = first.dimension;
        }
        if (chunkX === null) chunkX = first.chunkX;
        if (chunkZ === null) chunkZ = first.chunkZ;
      }

      if (dimension === null || chunkX === null || chunkZ === null) {
        return res.status(400).json({ ok: false, error: 'dimension, chunkX, and chunkZ are required when they cannot be derived from shops or waystones' });
      }

      if (Number.isNaN(chunkX) || Number.isNaN(chunkZ)) {
        return res.status(400).json({ ok: false, error: 'chunkX and chunkZ must be numbers' });
      }

      const shopsRows = normalizedShops.map((shop) => {
        const derivedChunks = deriveChunkFromPosition([shop.posX, shop.posY, shop.posZ]);
        return {
          owner: shop.owner,
          item: shop.item,
          posX: shop.posX,
          posY: shop.posY,
          posZ: shop.posZ,
          dimension: shop.dimension,
          price: shop.price,
          amount: shop.amount,
          action: shop.action,
          chunkX: derivedChunks.chunkX,
          chunkZ: derivedChunks.chunkZ
        };
      });

      const waystoneRows = normalizedWaystones.map((waystone) => ({
        posX: waystone.posX,
      posY: waystone.posY,
      posZ: waystone.posZ,
      dimension: waystone.dimension,
      chunkX: waystone.chunkX,
      chunkZ: waystone.chunkZ,
      source: waystone.source
      }));

      let scanId;
      try {
        scanId = ctx.insertScanTx(
          {
            senderId,
            dimension,
            chunkX,
            chunkZ,
            scannedAt: scannedAtIso
          },
          shopsRows,
          waystoneRows
        );
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ ok: false, error: 'duplicate scan data' });
        }
        throw err;
      }

      return res.status(201).json({
        ok: true,
        scanId,
        dimension,
        chunkX,
        chunkZ,
        observed: shopsRows.length,
        observedWaystones: waystoneRows.length
      });
    } catch (err) {
      console.error(err);
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
};

module.exports = registerScanRoutes;
