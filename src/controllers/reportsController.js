import prisma from '../utils/prisma.js';
import { sendCsvRows } from '../utils/csvExport.js';
import { startOfDay, endOfDay, buildDailyChartForRange } from '../utils/statsHelpers.js';

function parseDateRange(query) {
  const now = new Date();
  const dateTo = query.dateTo ? endOfDay(new Date(query.dateTo)) : endOfDay(now);
  const dateFrom = query.dateFrom
    ? startOfDay(new Date(query.dateFrom))
    : startOfDay(new Date(dateTo.getTime() - 29 * 86400000));

  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return { error: 'Invalid date range' };
  }
  if (dateFrom > dateTo) {
    return { error: 'dateFrom must be before dateTo' };
  }

  return { dateFrom, dateTo };
}

function periodLabel(from, to) {
  return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
}

export async function exportOwnerAccountingReport(req, res, next) {
  try {
    const range = parseDateRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const { dateFrom, dateTo } = range;
    const ownerId = req.owner.id;
    const periodWhere = { ownerId, createdAt: { gte: dateFrom, lte: dateTo } };

    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
      select: { name: true, email: true },
    });

    const [successTx, allTx, locations] = await Promise.all([
      prisma.transaction.findMany({
        where: { ...periodWhere, status: 'SUCCESS' },
        include: {
          location: { select: { name: true } },
          package: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.transaction.findMany({
        where: periodWhere,
        select: { status: true, amountXaf: true, platformFeeXaf: true, ownerCreditXaf: true, voucherId: true },
      }),
      prisma.location.findMany({
        where: { ownerId },
        select: { id: true, name: true },
      }),
    ]);

    const gross = successTx.reduce((s, t) => s + t.amountXaf, 0);
    const fees = successTx.reduce((s, t) => s + t.platformFeeXaf, 0);
    const net = successTx.reduce((s, t) => s + t.ownerCreditXaf, 0);
    const momoNet = successTx.filter((t) => !t.voucherId).reduce((s, t) => s + t.ownerCreditXaf, 0);
    const voucherNet = successTx.filter((t) => t.voucherId).reduce((s, t) => s + t.ownerCreditXaf, 0);

    const statusCounts = allTx.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});

    const daily = buildDailyChartForRange(successTx, dateFrom, dateTo, 'ownerCreditXaf');

    const locationTotals = {};
    for (const tx of successTx) {
      locationTotals[tx.locationId] = (locationTotals[tx.locationId] || 0) + tx.ownerCreditXaf;
    }

    const rows = [
      ['SpaiHub Owner Accounting Report'],
      ['Owner', owner.name],
      ['Email', owner.email],
      ['Period', periodLabel(dateFrom, dateTo)],
      ['Generated at', new Date().toISOString()],
      [],
      ['SUMMARY'],
      ['Metric', 'Value (XAF or count)'],
      ['Successful transactions', successTx.length],
      ['Gross collected', gross],
      ['Platform fees', fees],
      ['Your net earnings', net],
      ['Mobile Money net', momoNet],
      ['Voucher net', voucherNet],
      ['Pending transactions', statusCounts.PENDING || 0],
      ['Failed transactions', statusCounts.FAILED || 0],
      [],
      ['DAILY NET EARNINGS'],
      ['Date', 'Your share (XAF)'],
      ...daily.map((d) => [d.date, d.amount]),
      [],
      ['REVENUE BY LOCATION'],
      ['Location', 'Your share (XAF)'],
      ...locations
        .map((loc) => [loc.name, locationTotals[loc.id] || 0])
        .filter((row) => row[1] > 0)
        .sort((a, b) => b[1] - a[1]),
      [],
      ['TRANSACTION DETAIL'],
      [
        'Date',
        'Location',
        'Package',
        'Payment source',
        'Subscriber phone',
        'Gross (XAF)',
        'Platform fee (XAF)',
        'Your share (XAF)',
        'Status',
      ],
      ...successTx.map((tx) => [
        tx.createdAt.toISOString(),
        tx.location.name,
        tx.package.name,
        tx.voucherId ? 'Voucher' : 'Mobile Money',
        tx.subscriberPhone,
        tx.amountXaf,
        tx.platformFeeXaf,
        tx.ownerCreditXaf,
        tx.status,
      ]),
    ];

    const filename = `spaihub-accounting-${dateFrom.toISOString().slice(0, 10)}-${dateTo.toISOString().slice(0, 10)}.csv`;
    sendCsvRows(res, filename, rows);
  } catch (err) {
    next(err);
  }
}

export async function exportAdminAccountingReport(req, res, next) {
  try {
    const range = parseDateRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const { dateFrom, dateTo } = range;
    const periodWhere = { createdAt: { gte: dateFrom, lte: dateTo } };

    const [successTx, allTx] = await Promise.all([
      prisma.transaction.findMany({
        where: { ...periodWhere, status: 'SUCCESS' },
        include: {
          owner: { select: { name: true, email: true } },
          location: { select: { name: true } },
          package: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.transaction.findMany({
        where: periodWhere,
        select: { status: true },
      }),
    ]);

    const gross = successTx.reduce((s, t) => s + t.amountXaf, 0);
    const fees = successTx.reduce((s, t) => s + t.platformFeeXaf, 0);
    const ownerShare = successTx.reduce((s, t) => s + t.ownerCreditXaf, 0);

    const statusCounts = allTx.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});

    const dailyGross = buildDailyChartForRange(successTx, dateFrom, dateTo, 'amountXaf');
    const dailyFees = buildDailyChartForRange(successTx, dateFrom, dateTo, 'platformFeeXaf');

    const ownerTotals = {};
    for (const tx of successTx) {
      if (!ownerTotals[tx.ownerId]) {
        ownerTotals[tx.ownerId] = { name: tx.owner.name, gross: 0, fees: 0 };
      }
      ownerTotals[tx.ownerId].gross += tx.amountXaf;
      ownerTotals[tx.ownerId].fees += tx.platformFeeXaf;
    }

    const rows = [
      ['SpaiHub Platform Accounting Report'],
      ['Period', periodLabel(dateFrom, dateTo)],
      ['Generated at', new Date().toISOString()],
      [],
      ['SUMMARY'],
      ['Metric', 'Value (XAF or count)'],
      ['Successful transactions', successTx.length],
      ['Gross revenue processed', gross],
      ['Platform fees earned', fees],
      ['Owner share paid out', ownerShare],
      ['Pending transactions', statusCounts.PENDING || 0],
      ['Failed transactions', statusCounts.FAILED || 0],
      [],
      ['DAILY PLATFORM REVENUE'],
      ['Date', 'Gross (XAF)', 'Platform fees (XAF)'],
      ...dailyGross.map((d, i) => [d.date, d.amount, dailyFees[i]?.amount || 0]),
      [],
      ['REVENUE BY OWNER'],
      ['Owner', 'Gross (XAF)', 'Platform fees (XAF)'],
      ...Object.values(ownerTotals)
        .map((o) => [o.name, o.gross, o.fees])
        .sort((a, b) => b[1] - a[1]),
      [],
      ['TRANSACTION DETAIL'],
      [
        'Date',
        'Owner',
        'Owner email',
        'Location',
        'Package',
        'Payment source',
        'Gross (XAF)',
        'Platform fee (XAF)',
        'Owner share (XAF)',
        'Status',
      ],
      ...successTx.map((tx) => [
        tx.createdAt.toISOString(),
        tx.owner.name,
        tx.owner.email,
        tx.location.name,
        tx.package.name,
        tx.voucherId ? 'Voucher' : 'Mobile Money',
        tx.amountXaf,
        tx.platformFeeXaf,
        tx.ownerCreditXaf,
        tx.status,
      ]),
    ];

    const filename = `spaihub-platform-accounting-${dateFrom.toISOString().slice(0, 10)}-${dateTo.toISOString().slice(0, 10)}.csv`;
    sendCsvRows(res, filename, rows);
  } catch (err) {
    next(err);
  }
}
