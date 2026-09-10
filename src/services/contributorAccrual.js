import prisma from '../utils/prisma.js';
import { recordContributorLedgerEntry } from './contributorLedger.js';
import logger from '../utils/logger.js';

const BYTES_PER_GB = 1024 ** 3;

/**
 * Ingest a monotonic bytesTotal counter for a link.
 * When link is not ACTIVE, sample is stored but no accrual is created.
 */
export async function ingestMeterSample(linkId, { bytesTotal, source = 'ADMIN' } = {}) {
  const total = BigInt(bytesTotal);
  if (total < 0n) {
    throw Object.assign(new Error('bytesTotal must be >= 0'), { statusCode: 400 });
  }

  return prisma.$transaction(async (tx) => {
    const link = await tx.contributorLink.findUnique({
      where: { id: linkId },
      include: {
        location: { select: { ownerId: true } },
      },
    });
    if (!link) {
      throw Object.assign(new Error('Contributor link not found'), { statusCode: 404 });
    }

    const previous = await tx.contributorMeterSample.findFirst({
      where: { linkId },
      orderBy: { recordedAt: 'desc' },
    });

    if (previous && total < previous.bytesTotal) {
      throw Object.assign(
        new Error('bytesTotal must be greater than or equal to the last sample'),
        { statusCode: 400 }
      );
    }

    const sample = await tx.contributorMeterSample.create({
      data: {
        linkId,
        bytesTotal: total,
        source,
        recordedAt: new Date(),
      },
    });

    if (link.status !== 'ACTIVE') {
      return { sample, accrual: null, skipped: true, reason: 'Link is not ACTIVE' };
    }

    const prevTotal = previous ? previous.bytesTotal : 0n;
    const delta = total - prevTotal;
    if (delta <= 0n) {
      return { sample, accrual: null, skipped: true, reason: 'No new bytes' };
    }

    const amountXaf = Number((delta * BigInt(link.rateXafPerGb)) / BigInt(BYTES_PER_GB));
    if (amountXaf <= 0) {
      return { sample, accrual: null, skipped: true, reason: 'Delta too small to bill at current rate' };
    }

    const periodStart = previous?.recordedAt || link.createdAt;
    const periodEnd = sample.recordedAt;

    const accrual = await tx.contributorAccrual.create({
      data: {
        linkId,
        ownerId: link.location.ownerId,
        bytes: delta,
        amountXaf,
        status: 'OPEN',
        periodStart,
        periodEnd,
      },
    });

    await tx.contributor.update({
      where: { id: link.contributorId },
      data: { walletBalance: { increment: amountXaf } },
    });

    await recordContributorLedgerEntry(tx, {
      contributorId: link.contributorId,
      type: 'CONTRIBUTION_CREDIT',
      amountXaf,
      referenceId: accrual.id,
      note: `Meter accrual ${delta} bytes @ ${link.rateXafPerGb} XAF/GB`,
    });

    logger.info('Contributor accrual created', {
      linkId,
      accrualId: accrual.id,
      amountXaf,
      bytes: delta.toString(),
    });

    return { sample, accrual, skipped: false };
  });
}
