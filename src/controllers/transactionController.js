import prisma from '../utils/prisma.js';

export async function getTransactions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const { locationId, status, dateFrom, dateTo } = req.query;

    const where = { ownerId: req.owner.id };
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
      transactions: transactions.map((tx) => ({
        ...tx,
        locationName: tx.location.name,
        packageName: tx.package.name,
      })),
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

export async function exportTransactions(req, res, next) {
  try {
    const { locationId, status, dateFrom, dateTo } = req.query;

    const where = { ownerId: req.owner.id };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        location: { select: { name: true } },
        package: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Date',
      'Subscriber Phone',
      'Subscriber MAC',
      'Location',
      'Package',
      'Amount (XAF)',
      'Platform Fee (XAF)',
      'Your Share (XAF)',
      'Payment Source',
      'Status',
    ];

    const rows = transactions.map((tx) => [
      tx.createdAt.toISOString(),
      tx.subscriberPhone,
      tx.subscriberMac,
      tx.location.name,
      tx.package.name,
      tx.amountXaf,
      tx.platformFeeXaf,
      tx.ownerCreditXaf,
      tx.voucherId ? 'Voucher' : 'Mobile Money',
      tx.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}
