/** Local Cameroon mobile: 9 digits starting with 6 (e.g. 677123456). */
export function normalizeCameroonMobileLocal(phone) {
  if (!phone || typeof phone !== 'string') return null;

  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('237') && digits.length === 12) {
    return digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return digits.slice(1);
  }
  if (/^6\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
}

/** Campay requires country code: 2376XXXXXXXX */
export function toCampayPhone(phone) {
  const local = normalizeCameroonMobileLocal(phone);
  return local ? `237${local}` : null;
}
