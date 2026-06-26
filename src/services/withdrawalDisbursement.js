import prisma from '../utils/prisma.js';
import * as campay from './campay.js';
import { detectCameroonOperator, toCampayPhone } from '../utils/phone.js';

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAutoDisburseEnabled() {
  return process.env.AUTO_DISBURSE_WITHDRAWALS !== 'false';
}

export { isAutoDisburseEnabled };

async function verifyRecipientMoMo(campayPhone) {
  try {
    const holder = await campay.getHolderInfo(campayPhone);
    if (!holder?.full_name?.trim()) {
      throw Object.assign(
        new Error('This phone number is not registered for Mobile Money.'),
        { statusCode: 400 }
      );
    }
    return holder.full_name.trim();
  } catch (err) {
    if (err.statusCode === 400) throw err;

    const status = err.response?.status;
    const detail = String(err.response?.data?.detail || err.response?.data?.message || err.message || '');
    if (status === 404 || /not found|invalid phone|unknown number/i.test(detail)) {
      throw Object.assign(
        new Error('This phone number is not registered for Mobile Money.'),
        { statusCode: 400 }
      );
    }

    // Holder lookup can be unavailable; proceed and let /api/withdraw/ return the real error.
    return null;
  }
}

async function assertCampayBalance(amountXaf, operator) {
  try {
    const balance = await campay.getBalance();
    const total = Number(balance?.total_balance ?? 0);
    const networkBalance =
      operator === 'ORANGE'
        ? Number(balance?.orange_balance ?? 0)
        : Number(balance?.mtn_balance ?? 0);

    if (total < amountXaf) {
      throw Object.assign(
        new Error('Campay wallet balance is too low to process this withdrawal. Contact support.'),
        { statusCode: 503 }
      );
    }

    if (networkBalance > 0 && networkBalance < amountXaf) {
      const network = operator === 'ORANGE' ? 'Orange' : 'MTN';
      throw Object.assign(
        new Error(`Campay ${network} balance is too low for this withdrawal. Try again later or contact support.`),
        { statusCode: 503 }
      );
    }
  } catch (err) {
    if (err.statusCode) throw err;
    // Balance endpoint may fail if API withdrawal isn't enabled yet.
  }
}

async function waitForCampaySuccess(reference) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const tx = await campay.getTransactionStatus(reference);
    if (tx.status === 'SUCCESSFUL') {
      return tx;
    }
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

export async function disburseWithdrawal(withdrawal) {
  const campayPhone = toCampayPhone(withdrawal.phoneNumber);
  if (!campayPhone) {
    throw Object.assign(new Error('Invalid withdrawal phone number.'), { statusCode: 400 });
  }

  const operator = detectCameroonOperator(withdrawal.phoneNumber);
  if (!operator) {
    throw Object.assign(
      new Error('Use a valid MTN (67/68/650-654) or Orange (69/655-659) Mobile Money number.'),
      { statusCode: 400 }
    );
  }

  const amountXaf = Math.round(Number(withdrawal.amountXaf));
  if (!Number.isFinite(amountXaf) || amountXaf < 1) {
    throw Object.assign(new Error('Invalid withdrawal amount.'), { statusCode: 400 });
  }

  await verifyRecipientMoMo(campayPhone);
  await assertCampayBalance(amountXaf, operator);

  let reference = withdrawal.campayReference;
  let immediateStatus = null;

  if (!reference) {
    const initiated = await campay.initiateWithdrawal({
      amount: amountXaf,
      to: campayPhone,
      description: 'SpaiHub wallet withdrawal',
      externalReference: withdrawal.id,
    });
    reference = initiated.reference;
    immediateStatus = initiated.status;

    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { campayReference: reference },
    });
  }

  if (immediateStatus === 'SUCCESSFUL') {
    return { reference, status: 'SUCCESSFUL' };
  }

  const tx = await waitForCampaySuccess(reference);
  return { reference, status: tx.status };
}

export async function completeWithdrawalDisbursement(withdrawalId) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) {
    throw Object.assign(new Error('Withdrawal not found'), { statusCode: 404 });
  }

  const result = await disburseWithdrawal(withdrawal);

  return prisma.withdrawal.update({
    where: { id: withdrawalId },
    data: {
      status: 'APPROVED',
      campayReference: result.reference,
      processedAt: new Date(),
    },
  });
}

export async function failWithdrawalAndRefund(withdrawal, reason) {
  await prisma.$transaction(async (tx) => {
    await tx.owner.update({
      where: { id: withdrawal.ownerId },
      data: { walletBalance: { increment: withdrawal.amountXaf } },
    });

    await tx.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'REJECTED',
        adminNote: reason,
        processedAt: new Date(),
      },
    });
  });
}
