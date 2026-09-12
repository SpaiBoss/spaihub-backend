import prisma from '../utils/prisma.js';
import { sendWithdrawalStatusEmail } from '../services/email.js';
import * as campay from '../services/campay.js';
import {
  completeWithdrawalDisbursement,
  campayBalanceDiagnosis,
  failWithdrawalAndRefund,
} from '../services/withdrawalDisbursement.js';
import { detectCameroonOperator, toCampayPhone } from '../utils/phone.js';
import { parseTransactionFilters } from '../utils/queryValidation.js';
import {
  kickAllActiveSessionsForOwner,
  kickAllActiveSessionsForLocation,
} from '../services/sessionLifecycle.js';
import { countDeadLetterCommands } from '../services/routerCommandService.js';
import { processCampayStatus } from '../controllers/portalController.js';
import { normalizeCampayStatus } from '../utils/pendingPayment.js';
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
      deadLetterCommands24h,
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
      countDeadLetterCommands(24),
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
      deadLetterCommands24h,
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

    const [owners, total, revenueByOwner] = await Promise.all([
      prisma.owner.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { locations: true, transactions: true } } },
      }),
      prisma.owner.count(),
      prisma.transaction.groupBy({
        by: ['ownerId'],
        where: { status: 'SUCCESS' },
        _sum: { ownerCreditXaf: true },
      }),
    ]);

    const revenueMap = Object.fromEntries(
      revenueByOwner.map((row) => [row.ownerId, row._sum.ownerCreditXaf || 0])
    );

    const ownerStats = owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      status: owner.status,
      totalTransactions: owner._count.transactions,
      totalRevenue: revenueMap[owner.id] || 0,
      walletBalance: Number(owner.walletBalance),
      locationCount: owner._count.locations,
      createdAt: owner.createdAt,
    }));

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

    if (status === 'SUSPENDED' && owner.status === 'ACTIVE') {
      await kickAllActiveSessionsForOwner(id);
    }

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

    const { errors, where } = parseTransactionFilters(req.query);
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
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


export async function exportAdminTransactions(req, res, next) {
  try {
    const { errors, where } = parseTransactionFilters(req.query);
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

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
      const approved = await prisma.withdrawal.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          adminNote: note,
          processedAt: new Date(),
        },
      });

      if (approved.count === 0) {
        return res.status(400).json({ error: 'Withdrawal has already been processed' });
      }

      const updated = await prisma.withdrawal.findUnique({ where: { id } });

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
      await failWithdrawalAndRefund(withdrawal, adminNote.trim());
      const updated = await prisma.withdrawal.findUnique({ where: { id } });

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
    let rawBalance = null;
    let balanceError = null;
    try {
      rawBalance = await campay.getBalanceRaw();
      balance = campay.normalizeCampayBalance(rawBalance);
    } catch (err) {
      balanceError = err.message;
    }

    res.json({
      campayPhone,
      operator,
      holderName: holder?.full_name || null,
      holderError,
      campayReference: withdrawal.campayReference,
      campayTransactionStatus: withdrawal.campayReference
        ? await campay
            .getTransactionStatus(withdrawal.campayReference)
            .then((tx) => normalizeCampayStatus(tx.status))
            .catch((err) => ({ error: err.message }))
        : null,
      isDemo: campay.isCampayDemo(),
      isProduction: campay.isCampayProduction(),
      usesPermanentToken: Boolean(process.env.CAMPAY_PERMANENT_ACCESS_TOKEN?.trim()),
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
      rawBalance,
      campayBaseUrl: campay.getCampayBaseUrl(),
      apiWithdrawalHint:
        'If Send MoMo fails with Unauthorized MTN number: enable API withdrawal in app Settings on campay.net, or pay via Campay dashboard Withdraw then Mark paid manually here.',
    });
  } catch (err) {
    next(err);
  }
}

export async function activateOwner(req, res, next) {
  try {
    const { id } = req.params;

    const owner = await prisma.owner.findUnique({ where: { id } });
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    if (owner.status === 'ACTIVE') {
      return res.json(owner);
    }

    const updated = await prisma.owner.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifyToken: null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function reconcilePayment(req, res, next) {
  try {
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status === 'SUCCESS') {
      return res.json({ transaction, message: 'Already successful' });
    }

    if (!transaction.campayReference) {
      return res.status(400).json({ error: 'Transaction has no Campay reference' });
    }

    const campayStatus = await campay.getTransactionStatus(transaction.campayReference);
    const updated = await processCampayStatus(transaction.campayReference, campayStatus.status);

    res.json({
      transaction: updated,
      campayStatus: normalizeCampayStatus(campayStatus.status),
      message:
        updated?.status === 'SUCCESS'
          ? 'Payment recovered and session created'
          : 'Campay status applied',
    });
  } catch (err) {
    next(err);
  }
}

export async function listManagedLocations(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const activeFilter = req.query.isActive;

    const where = {};
    if (activeFilter === 'true') where.isActive = true;
    if (activeFilter === 'false') where.isActive = false;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { owner: { name: { contains: q, mode: 'insensitive' } } },
        { owner: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.location.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          owner: { select: { id: true, name: true, email: true, status: true } },
          routers: { select: { id: true, name: true, status: true, isActive: true } },
          _count: {
            select: {
              packages: true,
              transactions: true,
              vouchers: true,
              contributorLinks: true,
            },
          },
        },
      }),
      prisma.location.count({ where }),
    ]);

    res.json({
      locations: rows.map((loc) => ({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        isActive: loc.isActive,
        createdAt: loc.createdAt,
        owner: loc.owner,
        routerCount: loc.routers.length,
        onlineRouters: loc.routers.filter((r) => r.isActive && r.status === 'ONLINE').length,
        packageCount: loc._count.packages,
        transactionCount: loc._count.transactions,
        voucherCount: loc._count.vouchers,
        contributorLinkCount: loc._count.contributorLinks,
        canHardDelete:
          loc._count.transactions === 0 &&
          loc._count.vouchers === 0 &&
          loc._count.contributorLinks === 0,
      })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}

export async function getManagedLocation(req, res, next) {
  try {
    const location = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, name: true, email: true, status: true } },
        routers: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            status: true,
            isActive: true,
            lastSeenAt: true,
            deploymentType: true,
          },
        },
        packages: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            type: true,
            durationMinutes: true,
            priceXaf: true,
            dataCapMb: true,
            isActive: true,
            _count: { select: { transactions: true, vouchers: true } },
          },
        },
        _count: {
          select: { transactions: true, vouchers: true, contributorLinks: true },
        },
      },
    });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({
      ...location,
      packages: location.packages.map((p) => ({
        ...p,
        transactionCount: p._count.transactions,
        voucherCount: p._count.vouchers,
        canHardDelete: p._count.transactions === 0 && p._count.vouchers === 0,
        _count: undefined,
      })),
      canHardDelete:
        location._count.transactions === 0 &&
        location._count.vouchers === 0 &&
        location._count.contributorLinks === 0,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateManagedLocationStatus(req, res, next) {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive boolean is required' });
    }

    const location = await prisma.location.findUnique({ where: { id: req.params.id } });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const wasActive = location.isActive;
    const [updated] = await prisma.$transaction([
      prisma.location.update({
        where: { id: location.id },
        data: { isActive },
      }),
      ...(isActive === false
        ? [
            prisma.router.updateMany({
              where: { locationId: location.id },
              data: { isActive: false },
            }),
            prisma.package.updateMany({
              where: { locationId: location.id },
              data: { isActive: false },
            }),
          ]
        : []),
    ]);

    if (isActive === false && wasActive) {
      await kickAllActiveSessionsForLocation(location.id);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteManagedLocation(req, res, next) {
  try {
    const location = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { transactions: true, vouchers: true, contributorLinks: true },
        },
      },
    });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (
      location._count.transactions > 0 ||
      location._count.vouchers > 0 ||
      location._count.contributorLinks > 0
    ) {
      return res.status(409).json({
        error:
          'Cannot permanently delete a location with transactions, vouchers, or contributor links. Deactivate it instead.',
        transactionCount: location._count.transactions,
        voucherCount: location._count.vouchers,
        contributorLinkCount: location._count.contributorLinks,
      });
    }

    await kickAllActiveSessionsForLocation(location.id);
    await prisma.location.delete({ where: { id: location.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function updateManagedPackageStatus(req, res, next) {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive boolean is required' });
    }

    const existing = await prisma.package.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const updated = await prisma.package.update({
      where: { id: existing.id },
      data: { isActive },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteManagedPackage(req, res, next) {
  try {
    const existing = await prisma.package.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { transactions: true, vouchers: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Package not found' });
    }

    if (existing._count.transactions > 0 || existing._count.vouchers > 0) {
      return res.status(409).json({
        error:
          'Cannot permanently delete a package with transactions or vouchers. Deactivate it instead.',
        transactionCount: existing._count.transactions,
        voucherCount: existing._count.vouchers,
      });
    }

    await prisma.package.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
