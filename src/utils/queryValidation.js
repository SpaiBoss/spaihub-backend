const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRANSACTION_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED']);

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
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
