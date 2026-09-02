import prisma from '../utils/prisma.js';
import logger from '../utils/logger.js';
import { toWhatsAppChatId } from '../utils/phone.js';
import { getOpenWaSessionId, isOpenWaConfigured, sendText } from './openwa.js';

const MESSAGE_TYPES = {
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  SESSION_EXPIRING: 'SESSION_EXPIRING',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
};

function formatSessionEnd(sessionEnd) {
  if (!sessionEnd) return 'the end of your package';
  const d = sessionEnd instanceof Date ? sessionEnd : new Date(sessionEnd);
  return d.toLocaleString('en-GB', {
    timeZone: 'Africa/Douala',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function paymentMessage(sessionEnd) {
  return `Payment received. Your SpaiHub session is active until ${formatSessionEnd(sessionEnd)}.`;
}

function expiringMessage(sessionEnd) {
  return `Your SpaiHub hotspot session expires soon (${formatSessionEnd(sessionEnd)}). Top up on the portal to continue.`;
}

function expiredMessage() {
  return 'Your SpaiHub session has expired. Renew on the portal to continue.';
}

/**
 * Claim a notification row for idempotency. Returns the row if newly claimed, null if already exists.
 */
async function claimNotification({
  transactionId,
  recipientPhone,
  messageType,
  payload,
}) {
  try {
    return await prisma.whatsappNotification.create({
      data: {
        recipientPhone,
        sessionId: getOpenWaSessionId(),
        messageType,
        payload,
        status: 'PENDING',
        transactionId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return null;
    }
    throw err;
  }
}

async function markSent(id, openwaMessageId) {
  await prisma.whatsappNotification.update({
    where: { id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      openwaMessageId: openwaMessageId || null,
    },
  });
}

async function markFailed(id, errorMessage) {
  await prisma.whatsappNotification.update({
    where: { id },
    data: {
      status: 'FAILED',
      lastError: String(errorMessage || 'send failed').slice(0, 500),
    },
  });
}

async function dispatch({ transactionId, phone, messageType, text, payload }) {
  if (!isOpenWaConfigured()) {
    return;
  }

  const chatId = toWhatsAppChatId(phone);
  if (!chatId) {
    logger.warn('Skipping WhatsApp notify: invalid phone', { transactionId, messageType });
    return;
  }

  const claim = await claimNotification({
    transactionId,
    recipientPhone: phone,
    messageType,
    payload,
  });

  if (!claim) {
    return;
  }

  try {
    const result = await sendText({ chatId, text });
    if (!result) {
      await markFailed(claim.id, 'OpenWA not configured');
      return;
    }
    await markSent(claim.id, result.messageId);
  } catch (err) {
    logger.warn('WhatsApp send failed', {
      transactionId,
      messageType,
      error: err.message,
    });
    try {
      await markFailed(claim.id, err.message);
    } catch (updateErr) {
      logger.warn('Failed to mark WhatsApp notification FAILED', {
        id: claim.id,
        error: updateErr.message,
      });
    }
  }
}

export async function notifyPaymentConfirmed(transaction) {
  if (!transaction?.id || !transaction.subscriberPhone) return;

  await dispatch({
    transactionId: transaction.id,
    phone: transaction.subscriberPhone,
    messageType: MESSAGE_TYPES.PAYMENT_CONFIRMED,
    text: paymentMessage(transaction.sessionEnd),
    payload: {
      sessionEnd: transaction.sessionEnd,
      amountXaf: transaction.amountXaf,
    },
  });
}

export async function notifySessionExpiring(transaction) {
  if (!transaction?.id || !transaction.subscriberPhone) return;

  await dispatch({
    transactionId: transaction.id,
    phone: transaction.subscriberPhone,
    messageType: MESSAGE_TYPES.SESSION_EXPIRING,
    text: expiringMessage(transaction.sessionEnd),
    payload: { sessionEnd: transaction.sessionEnd },
  });
}

export async function notifySessionExpired(transaction) {
  if (!transaction?.id || !transaction.subscriberPhone) return;

  await dispatch({
    transactionId: transaction.id,
    phone: transaction.subscriberPhone,
    messageType: MESSAGE_TYPES.SESSION_EXPIRED,
    text: expiredMessage(),
    payload: { sessionEnd: transaction.sessionEnd },
  });
}

export { MESSAGE_TYPES };
