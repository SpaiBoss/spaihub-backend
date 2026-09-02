import prisma from '../utils/prisma.js';
import logger from '../utils/logger.js';

export async function recordLedgerEntry(tx, { ownerId, type, amountXaf, referenceId, note }) {
  const owner = await tx.owner.findUnique({
    where: { id: ownerId },
    select: { walletBalance: true },
  });
  if (!owner) return;

  await tx.walletLedgerEntry.create({
    data: {
      ownerId,
      type,
      amountXaf,
      balanceAfterXaf: owner.walletBalance,
      referenceId: referenceId ?? null,
      note: note ?? null,
    },
  });
}

export async function getOwnerLedger(ownerId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [entries, total] = await Promise.all([
    prisma.walletLedgerEntry.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.walletLedgerEntry.count({ where: { ownerId } }),
  ]);
  return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function logMetric(name, meta = {}) {
  logger.info(`metric:${name}`, meta);
}
