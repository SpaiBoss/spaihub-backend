import prisma from '../utils/prisma.js';
import * as mikrotik from './mikrotik.js';

/** Kick one device MAC only — session stays active for shared plans. */
export async function disconnectDeviceOnly(transaction, macAddress) {
  if (!transaction?.hotspotUsername || !transaction?.routerId) return false;

  await mikrotik.kickUser({
    routerId: transaction.routerId,
    username: transaction.hotspotUsername,
    macAddress: macAddress ?? transaction.subscriberMac,
  });

  return true;
}

/**
 * End a SpaiHub session in the database and queue MikroTik disconnect for all devices.
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

    await prisma.transaction.updateMany({
      where: { id: transaction.id, kickedAt: null },
      data: { kickedAt: now },
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

export async function kickAllActiveSessionsForOwner(ownerId) {
  const now = new Date();
  const sessions = await prisma.transaction.findMany({
    where: {
      ownerId,
      status: 'SUCCESS',
      sessionEnd: { gt: now },
      hotspotUsername: { not: null },
    },
    select: {
      id: true,
      routerId: true,
      hotspotUsername: true,
      subscriberMac: true,
      sessionEnd: true,
    },
  });

  for (const session of sessions) {
    await endHotspotSession(session);
  }

  return sessions.length;
}

export async function kickAllActiveSessionsForLocation(locationId) {
  const now = new Date();
  const sessions = await prisma.transaction.findMany({
    where: {
      locationId,
      status: 'SUCCESS',
      sessionEnd: { gt: now },
      hotspotUsername: { not: null },
    },
    select: {
      id: true,
      routerId: true,
      hotspotUsername: true,
      subscriberMac: true,
      sessionEnd: true,
    },
  });

  for (const session of sessions) {
    await endHotspotSession(session);
  }

  return sessions.length;
}
