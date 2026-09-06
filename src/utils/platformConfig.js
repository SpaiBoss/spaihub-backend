/** Shared platform fee percent from env (default 2). */
export function getPlatformFeePercent() {
  const value = Number(process.env.PLATFORM_FEE_PERCENT);
  if (!Number.isFinite(value) || value < 0) return 2;
  return value;
}

/** Digits-only WhatsApp number for wa.me links (e.g. 2376XXXXXXXX). */
export function getContactWhatsApp() {
  const raw = process.env.CONTACT_WHATSAPP?.trim() || '';
  return raw.replace(/\D/g, '');
}
