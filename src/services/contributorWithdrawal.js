import prisma from '../utils/prisma.js';
import * as campay from './campay.js';
import { toCampayPhone } from '../utils/phone.js';
import { recordLedgerEntry } from './walletLedger.js';
import { recordContributorLedgerEntry } from './contributorLedger.js';

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Allocate FIFO OPEN accruals for a contributor up to amountXaf.
 * Returns allocations [{ accrual, takeXaf }] and ownerDebits { ownerId: amount }.
 */
export function allocateAccrualsFifo(accruals, amountXaf) {
  let remaining = Number(amountXaf);
  const allocations = [];
  const ownerDebits = {};

  for (const accrual of accruals) {
    if (remaining <= 0) break;
    const take = Math.min(accrual.amountXaf, remaining);
    allocations.push({ accrual, takeXaf: take });
    ownerDebits[accrual.ownerId] = (ownerDebits[accrual.ownerId] || 0) + take;
    remaining -= take;
  }

  if (remaining > 0) {
    throw Object.assign(new Error('Not enough open accruals to cover withdrawal'), { statusCode: 400 });
  }

  return { allocations, ownerDebits };
}

/**
 * Debit contributor + owners, mark/split accruals PAID, create PENDING withdrawal.
 */
export async function settleContributorWithdrawalRequest(tx, {
  contributorId,
  amountXaf,
  phoneNumber,
  method,
  idempotencyKey,
}) {
  const amount = Number(amountXaf);

  const debitedContrib = await tx.contributor.updateMany({
    where: { id: contributorId, walletBalance: { gte: amount } },
    data: { walletBalance: { decrement: amount } },
  });
  if (debitedContrib.count === 0) {
    throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 400 });
  }

  const openAccruals = await tx.contributorAccrual.findMany({
    where: {
      status: 'OPEN',
      link: { contributorId },
    },
    orderBy: { createdAt: 'asc' },
  });

  const { allocations, ownerDebits } = allocateAccrualsFifo(openAccruals, amount);

  for (const [ownerId, debit] of Object.entries(ownerDebits)) {
    const debited = await tx.owner.updateMany({
      where: { id: ownerId, walletBalance: { gte: debit } },
      data: { walletBalance: { decrement: debit } },
    });
    if (debited.count === 0) {
      throw Object.assign(
        new Error('Owner wallet cannot cover contributor payout. Contact support.'),
        { statusCode: 400 }
      );
    }
  }

  const withdrawal = await tx.contributorWithdrawal.create({
    data: {
      contributorId,
      amountXaf: amount,
      phoneNumber,
      method,
      status: 'PENDING',
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  });

  for (const { accrual, takeXaf } of allocations) {
    if (takeXaf === accrual.amountXaf) {
      await tx.contributorAccrual.update({
        where: { id: accrual.id },
        data: { status: 'PAID', withdrawalId: withdrawal.id },
      });
    } else {
      const remainBytes =
        (BigInt(accrual.bytes) * BigInt(accrual.amountXaf - takeXaf)) / BigInt(accrual.amountXaf);
      const paidBytes = BigInt(accrual.bytes) - remainBytes;

      await tx.contributorAccrual.update({
        where: { id: accrual.id },
        data: {
          amountXaf: takeXaf,
          bytes: paidBytes,
          status: 'PAID',
          withdrawalId: withdrawal.id,
        },
      });

      await tx.contributorAccrual.create({
        data: {
          linkId: accrual.linkId,
          ownerId: accrual.ownerId,
          bytes: remainBytes,
          amountXaf: accrual.amountXaf - takeXaf,
          status: 'OPEN',
          periodStart: accrual.periodStart,
          periodEnd: accrual.periodEnd,
        },
      });
    }
  }

  await recordContributorLedgerEntry(tx, {
    contributorId,
    type: 'WITHDRAWAL_DEBIT',
    amountXaf: -amount,
    referenceId: withdrawal.id,
    note: `Withdrawal request to ${phoneNumber}`,
  });

  for (const [ownerId, debit] of Object.entries(ownerDebits)) {
    await recordLedgerEntry(tx, {
      ownerId,
      type: 'CONTRIBUTOR_PAYOUT_DEBIT',
      amountXaf: -debit,
      referenceId: withdrawal.id,
      note: `Contributor payout ${withdrawal.id}`,
    });
  }

  return withdrawal;
}

/**
 * Refund contributor + owners and reopen accruals linked to a rejected withdrawal.
 */
export async function failContributorWithdrawalAndRefund(withdrawalId, adminNote) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.contributorWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || withdrawal.status !== 'PENDING') {
      throw Object.assign(new Error('Withdrawal is not pending'), { statusCode: 409 });
    }

    const paidAccruals = await tx.contributorAccrual.findMany({
      where: { withdrawalId, status: 'PAID' },
    });

    const ownerRefunds = {};
    for (const a of paidAccruals) {
      ownerRefunds[a.ownerId] = (ownerRefunds[a.ownerId] || 0) + a.amountXaf;
    }

    await tx.contributor.update({
      where: { id: withdrawal.contributorId },
      data: { walletBalance: { increment: withdrawal.amountXaf } },
    });

    await recordContributorLedgerEntry(tx, {
      contributorId: withdrawal.contributorId,
      type: 'WITHDRAWAL_REFUND',
      amountXaf: withdrawal.amountXaf,
      referenceId: withdrawal.id,
      note: adminNote || 'Withdrawal rejected',
    });

    for (const [ownerId, refund] of Object.entries(ownerRefunds)) {
      await tx.owner.update({
        where: { id: ownerId },
        data: { walletBalance: { increment: refund } },
      });
      await recordLedgerEntry(tx, {
        ownerId,
        type: 'CONTRIBUTOR_PAYOUT_REFUND',
        amountXaf: refund,
        referenceId: withdrawal.id,
        note: adminNote || 'Contributor withdrawal rejected',
      });
    }

    await tx.contributorAccrual.updateMany({
      where: { withdrawalId },
      data: { status: 'OPEN', withdrawalId: null },
    });

    return tx.contributorWithdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'REJECTED',
        adminNote: adminNote || null,
        processedAt: new Date(),
        campayReference: null,
      },
    });
  });
}

async function waitForCampaySuccess(reference) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const tx = await campay.getTransactionStatus(reference);
    if (tx.status === 'SUCCESSFUL') return tx;
    if (tx.status === 'FAILED' || tx.status === 'CANCELLED') {
      throw Object.assign(
        new Error(`Mobile Money transfer failed (${tx.status || 'failed'}).`),
        { statusCode: 502 }
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw Object.assign(
    new Error('Mobile Money transfer is still processing. Try again in a few minutes.'),
    { statusCode: 504 }
  );
}

export async function completeContributorWithdrawalDisbursement(withdrawalId) {
  const withdrawal = await prisma.contributorWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) {
    throw Object.assign(new Error('Withdrawal not found'), { statusCode: 404 });
  }
  if (withdrawal.status === 'APPROVED') return withdrawal;
  if (withdrawal.status !== 'PENDING') {
    throw Object.assign(new Error('Withdrawal has already been processed.'), { statusCode: 409 });
  }

  const campayPhone = toCampayPhone(withdrawal.phoneNumber);
  if (!campayPhone) {
    throw Object.assign(new Error('Invalid withdrawal phone number.'), { statusCode: 400 });
  }

  let reference = withdrawal.campayReference;
  let immediateStatus = null;
  if (!reference) {
    const initiated = await campay.initiateWithdrawal({
      amount: withdrawal.amountXaf,
      to: campayPhone,
      description: 'SpaiHub contributor payout',
      externalReference: withdrawal.id,
    });
    reference = initiated.reference;
    immediateStatus = initiated.status;
    await prisma.contributorWithdrawal.update({
      where: { id: withdrawalId },
      data: { campayReference: reference },
    });
  }

  if (immediateStatus !== 'SUCCESSFUL') {
    await waitForCampaySuccess(reference);
  }

  return prisma.contributorWithdrawal.update({
    where: { id: withdrawalId },
    data: { status: 'APPROVED', processedAt: new Date() },
  });
}

export async function holdContributorWithdrawalForAdminRetry(withdrawalId, message, { clearCampayReference = false } = {}) {
  return prisma.contributorWithdrawal.update({
    where: { id: withdrawalId },
    data: {
      adminNote: message,
      ...(clearCampayReference ? { campayReference: null } : {}),
    },
  });
}

export async function markContributorWithdrawalApproved(withdrawalId, adminNote) {
  return prisma.contributorWithdrawal.update({
    where: { id: withdrawalId },
    data: {
      status: 'APPROVED',
      processedAt: new Date(),
      adminNote: adminNote || null,
    },
  });
}
