import prisma from '../utils/prisma.js';

/** Sum of OPEN contributor accruals for an owner (reserved against withdraw). */
export async function getOwnerContributorReservedXaf(ownerId, tx = prisma) {
  const agg = await tx.contributorAccrual.aggregate({
    where: { ownerId, status: 'OPEN' },
    _sum: { amountXaf: true },
  });
  return Number(agg._sum.amountXaf || 0);
}

export async function getOwnerAvailableXaf(ownerId, tx = prisma) {
  const owner = await tx.owner.findUnique({
    where: { id: ownerId },
    select: { walletBalance: true },
  });
  if (!owner) return { walletBalance: 0, contributorReservedXaf: 0, availableXaf: 0 };
  const walletBalance = Number(owner.walletBalance);
  const contributorReservedXaf = await getOwnerContributorReservedXaf(ownerId, tx);
  return {
    walletBalance,
    contributorReservedXaf,
    availableXaf: Math.max(0, walletBalance - contributorReservedXaf),
  };
}
