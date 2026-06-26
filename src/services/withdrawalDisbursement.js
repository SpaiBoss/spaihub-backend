import prisma from '../utils/prisma.js';
import * as campay from './campay.js';
import { toCampayPhone } from '../utils/phone.js';

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAutoDisburseEnabled() {
  return process.env.AUTO_DISBURSE_WITHDRAWALS !== 'false';
}

export { isAutoDisburseEnabled };

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

  let reference = withdrawal.campayReference;
  let immediateStatus = null;

  if (!reference) {
    const initiated = await campay.initiateWithdrawal({
      amount: withdrawal.amountXaf,
      to: campayPhone,
      description: `SpaiHub wallet withdrawal`,
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
