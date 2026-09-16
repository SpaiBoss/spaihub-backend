export function normalizePreferredLocale(value) {
  return String(value || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function isPreferredLocale(value) {
  return value === 'en' || value === 'fr';
}
