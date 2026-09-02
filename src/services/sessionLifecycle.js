import prisma from '../utils/prisma.js';
import * as mikrotik from './mikrotik.js';

/**
 * End a SpaiHub session in the database and queue MikroTik disconnect.
 * Returns false when no transaction was provided.
 */
export async function endHotspotSession(transaction) {
  if (!transaction) return false;

  const now = new Date();
  const alreadyEnded = transaction.sessionEnd && new Date(transaction.sessionEnd) <= now;

  if (transaction.hotspotUsername && transaction.routerId) {
    await mikrotik.kickUser({
      routerId: transaction.routerId,
      username: transaction.hotspotUsername,
      macAddress: transaction.subscriberMac,
    });
  }

  if (!alreadyEnded) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { sessionEnd: now },
    });
  }

  return true;
}
