const registerItemRoutes = (app, ctx) => {
  app.get('/v1/item', (req, res) => {
    try {
      const itemParam = req.query.item ? String(req.query.item).trim() : '';
      if (!itemParam) {
        return res.status(400).json({ ok: false, error: 'item query param is required' });
      }

      const params = {
        item: itemParam,
        dimension: null,
        limit: 3
      };

      const sellersRows = ctx.latestShops.topSellers(params);
      const buyersRows = ctx.latestShops.topBuyers(params);

      const shapeEntry = (row) => {
        const hasNearest = row.nearest_waystone_x !== null && row.nearest_waystone_x !== undefined;
        const nearestWaystone = hasNearest
          ? {
              name: row.nearest_waystone_name || null,
              owner: row.nearest_waystone_owner || null,
              position: [row.nearest_waystone_x, row.nearest_waystone_y, row.nearest_waystone_z],
              distanceSq: row.nearest_waystone_distance_sq
            }
          : null;

        return {
          owner: row.owner,
          price: row.price,
          amount: row.amount,
          coords: [row.pos_x, row.pos_y, row.pos_z],
          dimension: row.dimension,
          lastSeenAt: row.observed_at,
          nearestWaystone
        };
      };

      const topSellers = sellersRows.map(shapeEntry);
      const topBuyers = buyersRows.map(shapeEntry);

      const latestObserved = ctx.latestShops.latestObserved({ item: itemParam, dimension: null });
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
