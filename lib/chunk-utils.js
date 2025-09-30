const deriveChunkFromPosition = (position) => {
  const [x, , z] = position;
  return {
    chunkX: Math.floor(Number(x) / 16),
    chunkZ: Math.floor(Number(z) / 16)
  };
};

const chunkKey = (dimension, chunkX, chunkZ) => `${dimension}|${chunkX}|${chunkZ}`;

const groupRowsByChunk = (seedChunk, rows, options = {}) => {
  const { bucketKey = 'rows', rowChunkResolver } = options;

  const resolveRowChunk = rowChunkResolver || ((row) => ({
    dimension: row.dimension,
    chunkX: row.chunkX,
    chunkZ: row.chunkZ
  }));

  const buckets = new Map();

  const ensureBucket = (dimension, chunkX, chunkZ) => {
    if (dimension === undefined || chunkX === undefined || chunkZ === undefined) {
      return null;
    }

    const key = chunkKey(dimension, chunkX, chunkZ);
    if (!buckets.has(key)) {
      buckets.set(key, {
        dimension,
        chunkX,
        chunkZ,
        [bucketKey]: []
      });
    }
    return buckets.get(key);
  };

  if (seedChunk && seedChunk.dimension !== undefined && seedChunk.chunkX !== undefined && seedChunk.chunkZ !== undefined) {
    ensureBucket(seedChunk.dimension, seedChunk.chunkX, seedChunk.chunkZ);
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const { dimension, chunkX, chunkZ } = resolveRowChunk(row) || {};
    const bucket = ensureBucket(dimension, chunkX, chunkZ);
    if (!bucket) {
      continue;
    }
    bucket[bucketKey].push(row);
  }

  return buckets;
};

module.exports = {
  deriveChunkFromPosition,
  chunkKey,
  groupRowsByChunk
};
