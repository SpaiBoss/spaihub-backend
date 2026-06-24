import prisma from '../utils/prisma.js';
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  sumOwnerCredit,
  buildDailyChart,
} from '../utils/statsHelpers.js';

export async function getOwnerStats(req, res, next) {
  try {
    const ownerId = req.owner.id;
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
    const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000));
    const monthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd = endOfDay(new Date(monthStart.getTime() - 1));

    const successTodayWhere = {
      ownerId,
      status: 'SUCCESS',
      createdAt: { gte: todayStart, lte: todayEnd },
    };

    const [
      todayRevenue,
      yesterdayRevenue,
      monthRevenue,
      lastMonthRevenue,
      allTimeRevenue,
      owner,
      activeSessions,
      transactionsToday,
      uniqueSubscribersToday,
      momoRevenueMonth,
      voucherRevenueMonth,
      pendingTransactions,
      failedTransactionsMonth,
      topPackages,
    ] = await Promise.all([
      sumOwnerCredit(prisma, { ownerId, createdAt: { gte: todayStart, lte: todayEnd } }),
      sumOwnerCredit(prisma, { ownerId, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } }),
      sumOwnerCredit(prisma, { ownerId, createdAt: { gte: monthStart, lte: now } }),
      sumOwnerCredit(prisma, { ownerId, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } }),
      sumOwnerCredit(prisma, { ownerId, createdAt: { lte: now } }),
      prisma.owner.findUnique({ where: { id: ownerId }, select: { walletBalance: true } }),
      prisma.transaction.count({
        where: { ownerId, status: 'SUCCESS', sessionEnd: { gt: now } },
      }),
      prisma.transaction.count({ where: successTodayWhere }),
      prisma.transaction.groupBy({
        by: ['subscriberPhone'],
        where: { ...successTodayWhere, subscriberPhone: { not: null } },
      }).then((rows) => rows.length),
      sumOwnerCredit(prisma, {
        ownerId,
        voucherId: null,
        createdAt: { gte: monthStart, lte: now },
      }),
      sumOwnerCredit(prisma, {
        ownerId,
        voucherId: { not: null },
        createdAt: { gte: monthStart, lte: now },
      }),
      prisma.transaction.count({ where: { ownerId, status: 'PENDING' } }),
      prisma.transaction.count({
        where: { ownerId, status: 'FAILED', createdAt: { gte: monthStart, lte: now } },
      }),
      prisma.transaction.groupBy({
        by: ['packageId'],
        where: successTodayWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 3,
      }),
    ]);

    const packageIds = topPackages.map((p) => p.packageId);
    const packages = await prisma.package.findMany({
      where: { id: { in: packageIds } },
      select: { id: true, name: true },
    });
    const packageMap = Object.fromEntries(packages.map((p) => [p.id, p.name]));

    const monthChangePercent =
      lastMonthRevenue > 0
        ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
        : monthRevenue > 0
          ? 100
          : 0;

    res.json({
      todayRevenue,
      yesterdayRevenue,
      monthRevenue,
      lastMonthRevenue,
      monthChangePercent,
      allTimeRevenue,
      walletBalance: Number(owner.walletBalance),
      activeSessions,
      transactionsToday,
      subscribersToday: transactionsToday,
      uniqueSubscribersToday,
      momoRevenueMonth,
      voucherRevenueMonth,
      pendingTransactions,
      failedTransactionsMonth,
      topPackages: topPackages.map((p) => ({
        packageId: p.packageId,
        name: packageMap[p.packageId] || 'Unknown',
        count: p._count.id,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getRevenueChart(req, res, next) {
  try {
    const ownerId = req.owner.id;
    const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: {
        ownerId,
        status: 'SUCCESS',
        createdAt: { gte: from },
      },
      select: { createdAt: true, ownerCreditXaf: true },
    });

    res.json(buildDailyChart(transactions, days, 'ownerCreditXaf'));
  } catch (err) {
    next(err);
  }
}

export async function getOwnerAnalytics(req, res, next) {
  try {
    const ownerId = req.owner.id;
    const days = 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const [locations, transactions, voucherStats] = await Promise.all([
      prisma.location.findMany({
        where: { ownerId, isActive: true },
        select: { id: true, name: true },
      }),
      prisma.transaction.findMany({
        where: { ownerId, status: 'SUCCESS', createdAt: { gte: from } },
        select: { locationId: true, ownerCreditXaf: true, voucherId: true },
      }),
      Promise.all([
        prisma.voucher.count({ where: { location: { ownerId }, status: 'UNUSED' } }),
        prisma.voucher.count({ where: { location: { ownerId }, status: 'REDEEMED' } }),
        prisma.voucher.count({ where: { location: { ownerId }, status: 'EXPIRED' } }),
      ]),
    ]);

    const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
    const revenueByLocationMap = {};
    let momoTotal = 0;
    let voucherTotal = 0;

    for (const tx of transactions) {
      revenueByLocationMap[tx.locationId] = (revenueByLocationMap[tx.locationId] || 0) + tx.ownerCreditXaf;
      if (tx.voucherId) voucherTotal += tx.ownerCreditXaf;
      else momoTotal += tx.ownerCreditXaf;
    }

    const revenueByLocation = Object.entries(revenueByLocationMap)
      .map(([locationId, revenue]) => ({
        locationId,
        name: locationMap[locationId] || 'Unknown',
        revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const [unusedVouchers, redeemedVouchers, expiredVouchers] = voucherStats;
    const totalVouchers = unusedVouchers + redeemedVouchers + expiredVouchers;
    const redemptionRate =
      redeemedVouchers + expiredVouchers > 0
        ? Math.round((redeemedVouchers / (redeemedVouchers + expiredVouchers)) * 100)
        : 0;

    res.json({
      revenueByLocation,
      paymentMix: { momo: momoTotal, voucher: voucherTotal },
      vouchers: {
        unused: unusedVouchers,
        redeemed: redeemedVouchers,
        expired: expiredVouchers,
        total: totalVouchers,
        redemptionRate,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getRouterStatus(req, res, next) {
  try {
    const routers = await prisma.router.findMany({
      where: {
        isActive: true,
        location: { ownerId: req.owner.id },
      },
      include: { location: { select: { name: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });

    res.json(
      routers.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        lastSeenAt: r.lastSeenAt,
        locationName: r.location.name,
      }))
    );
  } catch (err) {
    next(err);
  }
}
