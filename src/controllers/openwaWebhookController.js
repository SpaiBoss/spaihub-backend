import crypto from 'crypto';
import logger from '../utils/logger.js';

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * OpenWA webhook receiver (v1 stub).
 * Verifies X-OpenWA-Signature HMAC, logs the event, returns 200.
 * No inbound command handling (RENEW / BALANCE) in v1.
 */
export async function openwaWebhook(req, res) {
  const secret = process.env.OPENWA_WEBHOOK_SECRET?.trim();

  if (!secret) {
    logger.warn('OpenWA webhook received but OPENWA_WEBHOOK_SECRET is not set');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const signature = req.headers['x-openwa-signature'];
  const rawBody = req.rawBody;

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    logger.warn('OpenWA webhook missing raw body for HMAC verification');
    return res.status(400).json({ error: 'Raw body required' });
  }

  if (!signature || typeof signature !== 'string') {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  if (!timingSafeEqualString(signature, expected)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body?.event || req.body?.type || 'unknown';
  logger.info('OpenWA webhook accepted', {
    event,
    sessionId: req.body?.sessionId,
  });

  return res.status(200).json({ received: true });
}
