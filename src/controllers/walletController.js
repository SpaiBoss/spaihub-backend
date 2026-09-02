import prisma from '../utils/prisma.js';
import {
  detectCameroonOperator,
  normalizeCameroonMobileLocal,
  paymentMethodForOperator,
} from '../utils/phone.js';
import { readIdempotencyKey } from '../utils/idempotency.js';
import { sendWithdrawalStatusEmail } from '../services/email.js';
import {
  completeWithdrawalDisbursement,
  holdWithdrawalForAdminRetry,
  isAutoDisburseEnabled,
} from '../services/withdrawalDisbursement.js';
import { recordLedgerEntry } from '../services/walletLedger.js';

const MIN_WITHDRAWAL = 100;

function withdrawalResponse(withdrawal, { pendingAdminRetry = false, message, error } = {}) {
  if (pendingAdminRetry) {
    return {
      status: 'PENDING',
      pendingAdminRetry: true,
      message,
      error,
      withdrawal: {
        id: withdrawal.id,
        amountXaf: withdrawal.amountXaf,
        status: withdrawal.status,
      },
    };
  }
  return withdrawal;
}

export async function getWallet(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [owner, withdrawals, total] = await Promise.all([
      prisma.owner.findUnique({
        where: { id: req.owner.id },
        select: { walletBalance: true },
      }),
      prisma.withdrawal.findMany({
        where: { ownerId: req.owner.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.withdrawal.count({ where: { ownerId: req.owner.id } }),
    ]);

    res.json({
      walletBalance: Number(owner.walletBalance),
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function requestWithdrawal(req, res, next) {
  try {
    const { amountXaf, phoneNumber, method: requestedMethod } = req.body;
    const idempotencyKey = readIdempotencyKey(req);

    if (!amountXaf || amountXaf < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XAF` });
    }

    const localPhone = normalizeCameroonMobileLocal(phoneNumber);
    if (!localPhone) {
      return res.status(400).json({ error: 'Enter a valid Cameroon mobile number (e.g. 677123456)' });
    }

    const operator = detectCameroonOperator(localPhone);
    const method = paymentMethodForOperator(operator);
    if (!method) {
      return res.status(400).json({
        error: 'Use a valid MTN MoMo (67/68/650-654) or Orange Money (69/655-659) number.',
      });
    }

    if (requestedMethod && requestedMethod !== method) {
      const network = operator === 'MTN' ? 'MTN MoMo' : 'Orange Money';
      return res.status(400).json({ error: `This number is ${network}. Use the matching Mobile Money network.` });
    }

    if (idempotencyKey) {
      const existing = await prisma.withdrawal.findUnique({
        where: { idempotencyKey },
      });

      if (existing) {
        if (existing.ownerId !== req.owner.id) {
          return res.status(409).json({ error: 'Duplicate request.' });
        }

        const statusCode = existing.status === 'PENDING' ? 202 : 201;
        return res.status(statusCode).json(existing);
      }
    }

    let withdrawal;
    try {
      withdrawal = await prisma.$transaction(async (tx) => {
        const debited = await tx.owner.updateMany({
          where: {
            id: req.owner.id,
            walletBalance: { gte: amountXaf },
          },
          data: { walletBalance: { decrement: amountXaf } },
        });

        if (debited.count === 0) {
          throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 400 });
        }

        const created = await tx.withdrawal.create({
          data: {
            ownerId: req.owner.id,
            amountXaf: Number(amountXaf),
            phoneNumber: localPhone,
            method,
            status: 'PENDING',
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        });

        await recordLedgerEntry(tx, {
          ownerId: req.owner.id,
          type: 'WITHDRAWAL_DEBIT',
          amountXaf: -Number(amountXaf),
          referenceId: created.id,
          note: `Withdrawal request to ${localPhone}`,
        });

        return created;
      });
    } catch (err) {
      if (err.code === 'P2002' && idempotencyKey) {
        const existing = await prisma.withdrawal.findUnique({ where: { idempotencyKey } });
        if (existing && existing.ownerId === req.owner.id) {
          const statusCode = existing.status === 'PENDING' ? 202 : 201;
          return res.status(statusCode).json(existing);
        }
      }
      throw err;
    }

    if (!isAutoDisburseEnabled()) {
      return res.status(201).json(withdrawal);
    }

    try {
      const completed = await completeWithdrawalDisbursement(withdrawal.id);

      try {
        const owner = await prisma.owner.findUnique({ where: { id: req.owner.id } });
        await sendWithdrawalStatusEmail(owner.email, {
          amountXaf: completed.amountXaf,
          status: 'APPROVED',
        });
      } catch {
        // Email failure shouldn't block withdrawal
      }

      return res.status(201).json(completed);
    } catch (err) {
      const message = err.message || 'Mobile Money transfer failed';
      const clearCampayReference = err.statusCode === 400 || err.statusCode === 502;
      await holdWithdrawalForAdminRetry(withdrawal.id, message, { clearCampayReference });

      return res.status(202).json(
        withdrawalResponse(withdrawal, {
          pendingAdminRetry: true,
          message: 'Withdrawal is queued. An admin will complete the MoMo transfer shortly.',
          error: message,
        })
      );
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}
