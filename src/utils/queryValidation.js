const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
/** TLDs / labels that are not usable for real inbox delivery */
const BLOCKED_TLDS = new Set([
  'local',
  'localhost',
  'test',
  'example',
  'invalid',
  'internal',
  'lan',
  'home',
  'corp',
  'localdomain',
  'onion',
]);
const TRANSACTION_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED']);

/**
 * True only for deliverable-looking addresses (rejects .local, localhost, IP hosts, etc.).
 */
export function isValidEmail(email) {
  return getEmailValidationError(email) === null;
}

export function getEmailValidationError(email) {
  if (typeof email !== 'string') return 'Enter a valid email address';
  const value = email.trim().toLowerCase();
  if (!value || value.length > 254) return 'Enter a valid email address';
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address';

  const at = value.lastIndexOf('@');
  const domain = value.slice(at + 1);
  if (!domain || domain.includes('..')) return 'Enter a valid email address';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return 'Use a real email address (not an IP host)';
  }

  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (!tld || tld.length < 2) return 'Enter a valid email address';
  if (labels.some((label) => BLOCKED_TLDS.has(label))) {
    return 'Use a real email inbox (Gmail, Yahoo, Outlook, or your own domain)';
  }

  return null;
}

export function normalizeEmail(email) {
  return email?.trim().toLowerCase();
}

function parseDateParam(value, label) {
  if (!value) return { value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `Invalid ${label} date` };
  }
  return { value: date };
}

export function parseTransactionFilters(query) {
  const errors = [];
  const { locationId, status, dateFrom, dateTo, ownerId } = query;

  if (status && !TRANSACTION_STATUSES.has(status)) {
    errors.push('Invalid status filter');
  }

  const from = parseDateParam(dateFrom, 'dateFrom');
  if (from.error) errors.push(from.error);

  const to = parseDateParam(dateTo, 'dateTo');
  if (to.error) errors.push(to.error);

  if (from.value && to.value && from.value > to.value) {
    errors.push('dateFrom must be before dateTo');
  }

  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (locationId) where.locationId = locationId;
  if (status) where.status = status;
  if (from.value || to.value) {
    where.createdAt = {};
    if (from.value) where.createdAt.gte = from.value;
    if (to.value) {
      const end = new Date(to.value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo))) {
        end.setHours(23, 59, 59, 999);
      }
      where.createdAt.lte = end;
    }
  }

  return { errors, where };
}
