import prisma from '../utils/prisma.js';
import { sendWithdrawalStatusEmail } from '../services/email.js';

export async function getPlatformStats(req, res, next) {
  try {
    const [
      totalOwners,
      totalTransactions,
      revenueAgg,
      feesAgg,
      withdrawnAgg,
      pendingWithdrawals,
    ] = await Promise.all([
      prisma.owner.count(),
      prisma.transaction.count({ where: { status: 'SUCCESS' } }),
      prisma.transaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amountXaf: true },
      }),
      prisma.transaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { platformFeeXaf: true },
      }),
      prisma.withdrawal.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amountXaf: true },
      }),
      prisma.withdrawal.findMany({
        where: { status: 'PENDING' },
        select: { amountXaf: true },
      }),
    ]);

    res.json({
      totalOwners,
      totalTransactions,
      totalRevenueProcessed: revenueAgg._sum.amountXaf || 0,
      totalPlatformFees: feesAgg._sum.platformFeeXaf || 0,
      totalWithdrawn: withdrawnAgg._sum.amountXaf || 0,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingWithdrawalsTotal: pendingWithdrawals.reduce((sum, w) => sum + w.amountXaf, 0),
    });
  } catch (err) {
    next(err);
  }
}

export async function getOwners(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [owners, total] = await Promise.all([
      prisma.owner.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { locations: true, transactions: true } } },
      }),
      prisma.owner.count(),
    ]);

    const ownerStats = await Promise.all(
      owners.map(async (owner) => {
        const revenue = await prisma.transaction.aggregate({
          where: { ownerId: owner.id, status: 'SUCCESS' },
          _sum: { ownerCreditXaf: true },
        });
        return {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          status: owner.status,
          totalTransactions: owner._count.transactions,
          totalRevenue: revenue._sum.ownerCreditXaf || 0,
          walletBalance: Number(owner.walletBalance),
          locationCount: owner._count.locations,
          createdAt: owner.createdAt,
        };
      })
    );

    res.json({
      owners: ownerStats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateOwnerStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE or SUSPENDED' });
    }

    const owner = await prisma.owner.findUnique({ where: { id } });
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const updated = await prisma.owner.update({
      where: { id },
      data: { status },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function getAllTransactions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const { ownerId, locationId, status, dateFrom, dateTo } = req.query;

    const where = {};
    if (ownerId) where.ownerId = ownerId;
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          owner: { select: { name: true, email: true } },
          location: { select: { name: true } },
          package: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function getWithdrawals(req, res, next) {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};

    const withdrawals = await prisma.withdrawal.findMany({
      where,
      include: { owner: { select: { name: true, email: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(withdrawals);
  } catch (err) {
    next(err);
  }
}

export async function processWithdrawal(req, res, next) {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'Action must be APPROVED or REJECTED' });
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'Withdrawal has already been processed' });
    }

    if (action === 'REJECTED' && !adminNote?.trim()) {
      return res.status(400).json({ error: 'Admin note is required when rejecting' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (action === 'REJECTED') {
        await tx.owner.update({
          where: { id: withdrawal.ownerId },
          data: { walletBalance: { increment: withdrawal.amountXaf } },
        });
      }

      return tx.withdrawal.update({
        where: { id },
        data: {
          status: action,
          adminNote: adminNote?.trim() || null,
          processedAt: new Date(),
        },
      });
    });

    try {
      await sendWithdrawalStatusEmail(withdrawal.owner.email, {
        amountXaf: withdrawal.amountXaf,
        status: action,
        adminNote: adminNote?.trim(),
      });
    } catch {
      // Email failure shouldn't block processing
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
