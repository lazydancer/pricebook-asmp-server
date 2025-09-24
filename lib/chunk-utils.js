const deriveChunkFromPosition = (position) => {
  const [x, , z] = position;
  return {
    chunkX: Math.floor(Number(x) / 16),
    chunkZ: Math.floor(Number(z) / 16)
  };
};

module.exports = {
  deriveChunkFromPosition
};
