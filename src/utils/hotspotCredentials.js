import crypto from 'crypto';

export function generateHotspotPin() {
  return String(crypto.randomInt(100000, 999999));
}

export function normalizeHotspotUsername(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export function escapeRouterOsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
