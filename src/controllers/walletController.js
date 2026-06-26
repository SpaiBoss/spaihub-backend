import prisma from '../utils/prisma.js';
import { normalizeCameroonMobileLocal } from '../utils/phone.js';
import { sendWithdrawalStatusEmail } from '../services/email.js';
import {
  completeWithdrawalDisbursement,
  failWithdrawalAndRefund,
  isAutoDisburseEnabled,
} from '../services/withdrawalDisbursement.js';

const MIN_WITHDRAWAL = 1000;

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
    const { amountXaf, phoneNumber, method } = req.body;

    if (!amountXaf || amountXaf < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XAF` });
    }

    if (!['MTN_MOMO', 'ORANGE_MONEY'].includes(method)) {
      return res.status(400).json({ error: 'Payment method must be MTN_MOMO or ORANGE_MONEY' });
    }

    const localPhone = normalizeCameroonMobileLocal(phoneNumber);
    if (!localPhone) {
      return res.status(400).json({ error: 'Enter a valid Cameroon mobile number (e.g. 677123456)' });
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const owner = await tx.owner.findUnique({ where: { id: req.owner.id } });

      if (Number(owner.walletBalance) < amountXaf) {
        throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 400 });
      }

      await tx.owner.update({
        where: { id: req.owner.id },
        data: { walletBalance: { decrement: amountXaf } },
      });

      return tx.withdrawal.create({
        data: {
          ownerId: req.owner.id,
          amountXaf: Number(amountXaf),
          phoneNumber: localPhone,
          method,
          status: 'PENDING',
        },
      });
    });

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
      await failWithdrawalAndRefund(withdrawal, message);

      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: message });
      }
      return res.status(502).json({ error: message });
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}
