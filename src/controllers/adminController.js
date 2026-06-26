import prisma from '../utils/prisma.js';
import { sendWithdrawalStatusEmail } from '../services/email.js';
import * as campay from '../services/campay.js';
import {
  completeWithdrawalDisbursement,
  campayBalanceDiagnosis,
} from '../services/withdrawalDisbursement.js';
import { detectCameroonOperator, toCampayPhone } from '../utils/phone.js';
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  sumPlatformAmounts,
  buildDailyChart,
} from '../utils/statsHelpers.js';

export async function getPlatformStats(req, res, next) {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd = endOfDay(new Date(monthStart.getTime() - 1));

    const [
      totalOwners,
      activeOwners,
      totalTransactions,
      revenueAgg,
      feesAgg,
      withdrawnAgg,
      pendingWithdrawals,
      todayTotals,
      monthTotals,
      lastMonthTotals,
      pendingTransactions,
      failedTransactionsMonth,
    ] = await Promise.all([
      prisma.owner.count(),
      prisma.owner.count({ where: { status: 'ACTIVE' } }),
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
      sumPlatformAmounts(prisma, { createdAt: { gte: todayStart, lte: todayEnd } }),
      sumPlatformAmounts(prisma, { createdAt: { gte: monthStart, lte: now } }),
      sumPlatformAmounts(prisma, { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } }),
      prisma.transaction.count({ where: { status: 'PENDING' } }),
      prisma.transaction.count({
        where: { status: 'FAILED', createdAt: { gte: monthStart, lte: now } },
      }),
    ]);

    const monthFeeChangePercent =
      lastMonthTotals.fees > 0
        ? Math.round(((monthTotals.fees - lastMonthTotals.fees) / lastMonthTotals.fees) * 100)
        : monthTotals.fees > 0
          ? 100
          : 0;

    res.json({
      totalOwners,
      activeOwners,
      totalTransactions,
      totalRevenueProcessed: revenueAgg._sum.amountXaf || 0,
      totalPlatformFees: feesAgg._sum.platformFeeXaf || 0,
      totalWithdrawn: withdrawnAgg._sum.amountXaf || 0,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingWithdrawalsTotal: pendingWithdrawals.reduce((sum, w) => sum + w.amountXaf, 0),
      todayGrossRevenue: todayTotals.gross,
      todayPlatformFees: todayTotals.fees,
      monthGrossRevenue: monthTotals.gross,
      monthPlatformFees: monthTotals.fees,
      lastMonthPlatformFees: lastMonthTotals.fees,
      monthFeeChangePercent,
      pendingTransactions,
      failedTransactionsMonth,
    });
  } catch (err) {
    next(err);
  }
}

export async function getPlatformRevenueChart(req, res, next) {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: { status: 'SUCCESS', createdAt: { gte: from } },
      select: { createdAt: true, amountXaf: true, platformFeeXaf: true },
    });

    const grossChart = buildDailyChart(
      transactions.map((tx) => ({ ...tx, ownerCreditXaf: tx.amountXaf })),
      days,
      'ownerCreditXaf'
    );
    const feesChart = buildDailyChart(
      transactions.map((tx) => ({ ...tx, ownerCreditXaf: tx.platformFeeXaf })),
      days,
      'ownerCreditXaf'
    );

    const chart = grossChart.map((row, i) => ({
      date: row.date,
      gross: row.amount,
      fees: feesChart[i]?.amount || 0,
    }));

    res.json(chart);
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
    const where = buildAdminTransactionWhere(req.query);

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

function buildAdminTransactionWhere(query) {
  const { ownerId, locationId, status, dateFrom, dateTo } = query;
  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (locationId) where.locationId = locationId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }
  return where;
}

export async function exportAdminTransactions(req, res, next) {
  try {
    const where = buildAdminTransactionWhere(req.query);

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        owner: { select: { name: true, email: true } },
        location: { select: { name: true } },
        package: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Date',
      'Owner',
      'Owner Email',
      'Location',
      'Package',
      'Amount (XAF)',
      'Platform Fee',
      'Owner Share',
      'Status',
      'Payment Source',
    ];
    const rows = transactions.map((tx) => [
      tx.createdAt.toISOString(),
      tx.owner.name,
      tx.owner.email,
      tx.location.name,
      tx.package.name,
      tx.amountXaf,
      tx.platformFeeXaf,
      tx.ownerCreditXaf,
      tx.status,
      tx.voucherId ? 'Voucher' : 'Mobile Money',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=platform-transactions.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function getWithdrawals(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const { status, history } = req.query;

    let where = {};
    if (status) {
      where.status = status;
    } else if (history === 'true') {
      where.status = { in: ['APPROVED', 'REJECTED'] };
    }

    const include = { owner: { select: { name: true, email: true } } };

    if (status === 'PENDING') {
      const withdrawals = await prisma.withdrawal.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
      withdrawals.sort((a, b) => {
        if (a.adminNote && !b.adminNote) return -1;
        if (!a.adminNote && b.adminNote) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      return res.json({
        withdrawals,
        pagination: {
          page: 1,
          limit: withdrawals.length,
          total: withdrawals.length,
          totalPages: 1,
        },
      });
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.withdrawal.count({ where }),
    ]);

    res.json({
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function processWithdrawal(req, res, next) {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;

    if (!['APPROVED', 'REJECTED', 'MANUAL_APPROVED'].includes(action)) {
      return res.status(400).json({ error: 'Action must be APPROVED, MANUAL_APPROVED, or REJECTED' });
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

    if (action === 'MANUAL_APPROVED') {
      const note = adminNote?.trim() || 'Paid manually via Campay dashboard';
      const updated = await prisma.withdrawal.update({
        where: { id },
        data: {
          status: 'APPROVED',
          adminNote: note,
          processedAt: new Date(),
        },
      });

      try {
        await sendWithdrawalStatusEmail(withdrawal.owner.email, {
          amountXaf: withdrawal.amountXaf,
          status: 'APPROVED',
        });
      } catch {
        // Email failure shouldn't block processing
      }

      return res.json(updated);
    }

    if (action === 'REJECTED') {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.owner.update({
          where: { id: withdrawal.ownerId },
          data: { walletBalance: { increment: withdrawal.amountXaf } },
        });

        return tx.withdrawal.update({
          where: { id },
          data: {
            status: 'REJECTED',
            adminNote: adminNote.trim(),
            processedAt: new Date(),
          },
        });
      });

      try {
        await sendWithdrawalStatusEmail(withdrawal.owner.email, {
          amountXaf: withdrawal.amountXaf,
          status: 'REJECTED',
          adminNote: adminNote.trim(),
        });
      } catch {
        // Email failure shouldn't block processing
      }

      return res.json(updated);
    }

    try {
      const updated = await completeWithdrawalDisbursement(withdrawal.id);

      try {
        await sendWithdrawalStatusEmail(withdrawal.owner.email, {
          amountXaf: withdrawal.amountXaf,
          status: 'APPROVED',
        });
      } catch {
        // Email failure shouldn't block processing
      }

      return res.json(updated);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(502).json({ error: err.message || 'Mobile Money transfer failed' });
    }
  } catch (err) {
    next(err);
  }
}

export async function verifyWithdrawalCampay(req, res, next) {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    const campayPhone = toCampayPhone(withdrawal.phoneNumber);
    const operator = detectCameroonOperator(withdrawal.phoneNumber);

    let holder = null;
    let holderError = null;
    try {
      holder = await campay.getHolderInfo(campayPhone);
    } catch (err) {
      const data = err.response?.data;
      holderError =
        (typeof data === 'object' && (data.detail || data.message)) ||
        (typeof data === 'string' ? data : err.message);
    }

    let balance = null;
    let balanceError = null;
    try {
      balance = await campay.getBalance();
    } catch (err) {
      balanceError = err.message;
    }

    res.json({
      campayPhone,
      operator,
      holderName: holder?.full_name || null,
      holderError,
      balance: balance
        ? {
            total: balance.total,
            mtn: balance.mtn,
            orange: balance.orange,
            currency: balance.currency || 'XAF',
            usesTotalFallback: balance.usesTotalFallback,
          }
        : null,
      balanceDiagnosis: balance
        ? campayBalanceDiagnosis(balance, operator, withdrawal.amountXaf)
        : null,
      balanceError,
      campayBaseUrl: campay.getCampayBaseUrl(),
      apiWithdrawalHint:
        'If Send MoMo fails with Unauthorized MTN number: enable API withdrawal in app Settings on campay.net, or pay via Campay dashboard Withdraw then Mark paid manually here.',
    });
  } catch (err) {
    next(err);
  }
}
