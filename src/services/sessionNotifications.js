import prisma from '../utils/prisma.js';
import {
  notifySessionExpired,
  notifySessionExpiring,
} from './whatsappNotify.js';
import logger from '../utils/logger.js';

const EXPIRING_WINDOW_MS = 15 * 60 * 1000;

export async function runSessionNotificationJob() {
  const now = new Date();
  const expiringBefore = new Date(now.getTime() + EXPIRING_WINDOW_MS);

  const expiring = await prisma.transaction.findMany({
    where: {
      status: 'SUCCESS',
      sessionEnd: { gt: now, lte: expiringBefore },
      subscriberPhone: { not: 'VOUCHER' },
    },
    take: 100,
  });

  for (const tx of expiring) {
    try {
      await notifySessionExpiring(tx);
    } catch (err) {
      logger.warn('Session expiring notification failed', { transactionId: tx.id, error: err.message });
    }
  }

  const expired = await prisma.transaction.findMany({
    where: {
      status: 'SUCCESS',
      sessionEnd: { lte: now, gte: new Date(now.getTime() - 5 * 60 * 1000) },
      subscriberPhone: { not: 'VOUCHER' },
    },
    take: 100,
  });

  for (const tx of expired) {
    try {
      await notifySessionExpired(tx);
    } catch (err) {
      logger.warn('Session expired notification failed', { transactionId: tx.id, error: err.message });
    }
  }

  return { expiring: expiring.length, expired: expired.length };
}
