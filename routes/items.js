const registerItemRoutes = (app, ctx) => {
  app.get('/v1/item', (req, res) => {
    try {
      const itemParam = req.query.item ? String(req.query.item).trim() : '';
      if (!itemParam) {
        return res.status(400).json({ ok: false, error: 'item query param is required' });
      }

      const dimensionParam = req.query.dimension ? String(req.query.dimension).trim() : null;
      const limitParam = req.query.limit !== undefined ? Number(req.query.limit) : 3;

      if (Number.isNaN(limitParam) || limitParam <= 0) {
        return res.status(400).json({ ok: false, error: 'limit must be a positive number when provided' });
      }

      const limit = Math.min(Math.trunc(limitParam), 10);
      const params = {
        item: itemParam,
        dimension: dimensionParam,
        limit
      };

      const sellersRows = ctx.latestShops.topSellers(params);
      const buyersRows = ctx.latestShops.topBuyers(params);
    const shapeEntry = (row) => ({
      owner: row.owner,
      price: row.price,
      amount: row.amount,
      coords: [row.pos_x, row.pos_y, row.pos_z],
      dimension: row.dimension,
      lastSeenAt: row.observed_at,
      nearestWaystone: row.nearest_waystone_x !== null && row.nearest_waystone_x !== undefined
        ? {
            name: row.nearest_waystone_name || null,
            position: [row.nearest_waystone_x, row.nearest_waystone_y, row.nearest_waystone_z],
            distanceSq: row.nearest_waystone_distance_sq
          }
        : null
    });

      const topSellers = sellersRows.map(shapeEntry);
      const topBuyers = buyersRows.map(shapeEntry);

      const latestObserved = ctx.latestShops.latestObserved({ item: itemParam, dimension: dimensionParam });
      const refreshedAt = latestObserved && latestObserved.latest_observed ? latestObserved.latest_observed : null;

      return res.json({
        ok: true,
        item: itemParam,
        refreshedAt,
        topSellers,
        topBuyers
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'failed to fetch item pricing' });
    }
  });

  app.get('/v1/items', (req, res) => {
    try {
      const rows = ctx.latestShops.listItems();
      const refreshed = ctx.latestShops.latestObservedAny();
      const refreshedAt = refreshed && refreshed.latest_observed ? refreshed.latest_observed : new Date().toISOString();

      return res.json({
        ok: true,
        refreshedAt,
        items: rows.map((row) => ({ name: row.item }))
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: 'failed to list items' });
    }
  });
};

module.exports = registerItemRoutes;
