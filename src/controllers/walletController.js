import prisma from '../utils/prisma.js';

const MIN_WITHDRAWAL = 1000;

function isValidPhone(phone) {
  return /^6\d{8}$/.test(phone);
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
    const { amountXaf, phoneNumber, method } = req.body;

    if (!amountXaf || amountXaf < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XAF` });
    }

    if (!['MTN_MOMO', 'ORANGE_MONEY'].includes(method)) {
      return res.status(400).json({ error: 'Payment method must be MTN_MOMO or ORANGE_MONEY' });
    }

    if (!isValidPhone(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
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
          phoneNumber,
          method,
          status: 'PENDING',
        },
      });
    });

    res.status(201).json(withdrawal);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}
