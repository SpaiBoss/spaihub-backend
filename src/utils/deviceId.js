const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidDeviceId(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function normalizeMac(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (cleaned.length !== 12) return null;
  return cleaned.match(/.{2}/g).join(':');
}
