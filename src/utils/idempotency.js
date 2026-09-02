export function readIdempotencyKey(req) {
  const header = req.headers['idempotency-key'];
  const fromHeader = typeof header === 'string' ? header.trim() : '';
  const fromBody = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  const key = fromHeader || fromBody;
  return key || null;
}
