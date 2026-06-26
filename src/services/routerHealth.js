import prisma from '../utils/prisma.js';
import * as mikrotik from './mikrotik.js';
import logger from '../utils/logger.js';

const TWO_MIN_MS = 2 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const KICK_WINDOW_MS = 3 * 60 * 1000;

export async function runRouterHealthJob() {
  const now = new Date();
  const twoMinAgo = new Date(now.getTime() - TWO_MIN_MS);
  const fiveMinAgo = new Date(now.getTime() - FIVE_MIN_MS);
  const kickWindowStart = new Date(now.getTime() - KICK_WINDOW_MS);

  const degraded = await prisma.router.updateMany({
    where: {
      isActive: true,
      status: 'ONLINE',
      lastSeenAt: { lt: twoMinAgo, gte: fiveMinAgo },
    },
    data: { status: 'DEGRADED' },
  });

  const offline = await prisma.router.updateMany({
    where: {
      isActive: true,
      status: { in: ['ONLINE', 'DEGRADED'] },
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: fiveMinAgo } }],
    },
    data: { status: 'OFFLINE' },
  });

  const expiredSessions = await prisma.transaction.findMany({
    where: {
      status: 'SUCCESS',
      sessionEnd: { gt: kickWindowStart, lte: now },
      hotspotUsername: { not: null },
    },
    select: { id: true, routerId: true, hotspotUsername: true },
  });

  for (const session of expiredSessions) {
    try {
      await mikrotik.kickUser({
        routerId: session.routerId,
        username: session.hotspotUsername,
      });
    } catch (err) {
      logger.warn('Failed to queue kick for expired session', {
        transactionId: session.id,
        error: err.message,
      });
    }
  }

  if (degraded.count || offline.count || expiredSessions.length) {
    logger.info('Router health job completed', {
      degraded: degraded.count,
      offline: offline.count,
      expiredKicks: expiredSessions.length,
    });
  }
}
