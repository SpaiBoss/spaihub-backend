import prisma from '../utils/prisma.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

async function getRevenueForPeriod(ownerId, from, to) {
  const result = await prisma.transaction.aggregate({
    where: {
      ownerId,
      status: 'SUCCESS',
      createdAt: { gte: from, lte: to },
    },
    _sum: { ownerCreditXaf: true },
  });
  return result._sum.ownerCreditXaf || 0;
}

export async function getOwnerStats(req, res, next) {
  try {
    const ownerId = req.owner.id;
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
    const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      todayRevenue,
      yesterdayRevenue,
      monthRevenue,
      allTimeRevenue,
      owner,
      activeSessions,
      subscribersToday,
      topPackages,
    ] = await Promise.all([
      getRevenueForPeriod(ownerId, todayStart, todayEnd),
      getRevenueForPeriod(ownerId, yesterdayStart, yesterdayEnd),
      getRevenueForPeriod(ownerId, monthStart, now),
      getRevenueForPeriod(ownerId, new Date(0), now),
      prisma.owner.findUnique({ where: { id: ownerId }, select: { walletBalance: true } }),
      prisma.transaction.count({
        where: { ownerId, status: 'SUCCESS', sessionEnd: { gt: now } },
      }),
      prisma.transaction.count({
        where: {
          ownerId,
          status: 'SUCCESS',
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.transaction.groupBy({
        by: ['packageId'],
        where: {
          ownerId,
          status: 'SUCCESS',
          createdAt: { gte: todayStart, lte: todayEnd },
        },
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

    res.json({
      todayRevenue,
      yesterdayRevenue,
      monthRevenue,
      allTimeRevenue,
      walletBalance: Number(owner.walletBalance),
      activeSessions,
      subscribersToday,
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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: {
        ownerId,
        status: 'SUCCESS',
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true, ownerCreditXaf: true },
    });

    const dailyMap = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = 0;
    }

    for (const tx of transactions) {
      const key = tx.createdAt.toISOString().split('T')[0];
      if (dailyMap[key] !== undefined) {
        dailyMap[key] += tx.ownerCreditXaf;
      }
    }

    const chart = Object.entries(dailyMap).map(([date, amount]) => ({ date, amount }));
    res.json(chart);
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
