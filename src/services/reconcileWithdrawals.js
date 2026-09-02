import prisma from '../utils/prisma.js';
import * as campay from './campay.js';
import { completeWithdrawalDisbursement } from './withdrawalDisbursement.js';
import { normalizeCampayStatus } from '../utils/pendingPayment.js';
import logger from '../utils/logger.js';

export async function reconcilePendingWithdrawals() {
  const pending = await prisma.withdrawal.findMany({
    where: {
      status: 'PENDING',
      campayReference: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  let completed = 0;
  let failed = 0;

  for (const withdrawal of pending) {
    try {
      const tx = await campay.getTransactionStatus(withdrawal.campayReference);
      const status = normalizeCampayStatus(tx.status);

      if (status === 'SUCCESSFUL') {
        await completeWithdrawalDisbursement(withdrawal.id);
        completed += 1;
      } else if (status === 'FAILED') {
        failed += 1;
      }
    } catch (err) {
      logger.warn('Withdrawal reconcile skipped', {
        withdrawalId: withdrawal.id,
        error: err.message,
      });
    }
  }

  if (completed || failed) {
    logger.info('Withdrawal reconciliation finished', { completed, failed, checked: pending.length });
  }

  return { completed, failed, checked: pending.length };
}
