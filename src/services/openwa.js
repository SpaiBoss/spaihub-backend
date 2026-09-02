import logger from '../utils/logger.js';

let missingConfigLogged = false;

function getConfig() {
  const baseUrl = process.env.OPENWA_BASE_URL?.trim().replace(/\/$/, '');
  const apiKey = process.env.OPENWA_API_KEY?.trim();
  const sessionId = process.env.OPENWA_SESSION_ID?.trim();
  const timeoutMs = Number(process.env.OPENWA_TIMEOUT_MS) || 8000;

  return { baseUrl, apiKey, sessionId, timeoutMs };
}

export function isOpenWaConfigured() {
  const { baseUrl, apiKey, sessionId } = getConfig();
  return Boolean(baseUrl && apiKey && sessionId);
}

/**
 * POST /api/sessions/{id}/messages/send-text
 * Returns { messageId, timestamp } on success.
 * No-ops (returns null) when OpenWA env is not configured.
 */
export async function sendText({ chatId, text }) {
  if (!isOpenWaConfigured()) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      logger.info('OpenWA not configured; WhatsApp notifications disabled');
    }
    return null;
  }

  if (!chatId || !text) {
    throw Object.assign(new Error('chatId and text are required'), { statusCode: 400 });
  }

  const { baseUrl, apiKey, sessionId, timeoutMs } = getConfig();
  const url = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ chatId, text }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = body?.message || body?.error || `OpenWA HTTP ${res.status}`;
      throw Object.assign(new Error(message), { statusCode: res.status, body });
    }

    return {
      messageId: body.messageId || body.id || null,
      timestamp: body.timestamp || null,
      raw: body,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getOpenWaSessionId() {
  return getConfig().sessionId || null;
}
