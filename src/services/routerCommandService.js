import prisma from '../utils/prisma.js';
import logger from '../utils/logger.js';
import { logMetric } from './walletLedger.js';

const MAX_ATTEMPTS = 3;
const DISPATCH_STALE_MS = 5 * 60 * 1000;

const RETRYABLE_STATUSES = ['PENDING', 'FAILED', 'DISPATCHED'];

export async function fetchPendingCommands(routerId) {
  const commands = await prisma.routerCommand.findMany({
    where: {
      routerId,
      status: { in: RETRYABLE_STATUSES },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (commands.length === 0) return [];

  const now = new Date();
  await prisma.routerCommand.updateMany({
    where: { id: { in: commands.map((c) => c.id) } },
    data: {
      status: 'DISPATCHED',
      dispatchedAt: now,
      attempts: { increment: 1 },
    },
  });

  return commands;
}

export async function acknowledgeCommands(routerId, { success, error, commandIds }) {
  const where = {
    routerId,
    status: 'DISPATCHED',
    ...(commandIds?.length ? { id: { in: commandIds } } : {}),
  };

  if (success) {
    const updated = await prisma.routerCommand.updateMany({
      where,
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        executed: true,
        lastError: null,
      },
    });
    return updated.count;
  }

  const failed = await prisma.routerCommand.updateMany({
    where,
    data: {
      status: 'FAILED',
      lastError: error || 'Router reported import failure',
    },
  });

  const toDeadLetter = await prisma.routerCommand.updateMany({
    where: {
      routerId,
      status: 'FAILED',
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: { status: 'DEAD_LETTER' },
  });

  if (toDeadLetter.count > 0) {
    logMetric('command_dead_letter', { routerId, count: toDeadLetter.count });
    logger.warn('Router commands moved to dead letter', { routerId, count: toDeadLetter.count });
  }

  return failed.count;
}

export async function retryStaleDispatchedCommands() {
  const cutoff = new Date(Date.now() - DISPATCH_STALE_MS);
  const stale = await prisma.routerCommand.findMany({
    where: {
      status: 'DISPATCHED',
      dispatchedAt: { lt: cutoff },
      attempts: { lt: MAX_ATTEMPTS },
    },
    select: { id: true },
  });

  if (stale.length === 0) return 0;

  await prisma.routerCommand.updateMany({
    where: { id: { in: stale.map((c) => c.id) } },
    data: {
      status: 'PENDING',
      lastError: 'Ack timeout — retrying',
    },
  });

  logger.info('Re-queued stale dispatched router commands', { count: stale.length });
  return stale.length;
}

export async function countDeadLetterCommands(sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  return prisma.routerCommand.count({
    where: {
      status: 'DEAD_LETTER',
      updatedAt: { gte: since },
    },
  });
}
