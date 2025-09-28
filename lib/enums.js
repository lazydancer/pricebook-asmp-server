const DIMENSION_CODECS = {
  overworld: 0,
  nether: 1,
  end: 2
};

const DIMENSION_LABELS = Object.entries(DIMENSION_CODECS).reduce((acc, [label, code]) => {
  acc[code] = label;
  return acc;
}, {});

const ACTION_CODECS = {
  sell: 0,
  buy: 1,
  'out of stock': 2
};

const ACTION_LABELS = Object.entries(ACTION_CODECS).reduce((acc, [label, code]) => {
  acc[code] = label;
  return acc;
}, {});

const normalizeDimension = (value) => {
  if (value === null || value === undefined) return null;
  const lowered = String(value).trim().toLowerCase();
  if (lowered === '') return null;
  if (lowered === 'the_nether' || lowered === 'the nether') return 'nether';
  return lowered;
};

const normalizeAction = (value) => {
  if (value === null || value === undefined) return null;
  const lowered = String(value).trim().toLowerCase();
  if (lowered === '') return null;
  return lowered;
};

const encodeDimension = (value) => {
  const normalized = normalizeDimension(value);
  if (normalized === null) return null;
  if (Object.prototype.hasOwnProperty.call(DIMENSION_CODECS, normalized)) {
    return DIMENSION_CODECS[normalized];
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && Object.prototype.hasOwnProperty.call(DIMENSION_LABELS, numeric)) {
    return numeric;
  }
  throw new Error(`Unknown dimension: ${value}`);
};

const decodeDimension = (code) => {
  if (code === null || code === undefined) return null;
  const label = DIMENSION_LABELS[code];
  if (label !== undefined) {
    return label;
  }
  throw new Error(`Unknown dimension code: ${code}`);
};

const encodeAction = (value) => {
  const normalized = normalizeAction(value);
  if (normalized === null) return null;
  if (Object.prototype.hasOwnProperty.call(ACTION_CODECS, normalized)) {
    return ACTION_CODECS[normalized];
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && Object.prototype.hasOwnProperty.call(ACTION_LABELS, numeric)) {
    return numeric;
  }
  throw new Error(`Unknown shop action: ${value}`);
};

const decodeAction = (code) => {
  if (code === null || code === undefined) return null;
  const label = ACTION_LABELS[code];
  if (label !== undefined) {
    return label;
  }
  throw new Error(`Unknown shop action code: ${code}`);
};

module.exports = {
  encodeDimension,
  decodeDimension,
  encodeAction,
  decodeAction,
  normalizeDimension,
  normalizeAction
};
