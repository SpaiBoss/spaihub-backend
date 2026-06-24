export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function sumOwnerCredit(prisma, where) {
  const result = await prisma.transaction.aggregate({
    where: { ...where, status: 'SUCCESS' },
    _sum: { ownerCreditXaf: true },
  });
  return result._sum.ownerCreditXaf || 0;
}

export async function sumPlatformAmounts(prisma, where) {
  const result = await prisma.transaction.aggregate({
    where: { ...where, status: 'SUCCESS' },
    _sum: { amountXaf: true, platformFeeXaf: true },
  });
  return {
    gross: result._sum.amountXaf || 0,
    fees: result._sum.platformFeeXaf || 0,
  };
}

export function buildDailyChart(transactions, days, valueKey = 'ownerCreditXaf') {
  const dailyMap = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    dailyMap[d.toISOString().split('T')[0]] = 0;
  }

  for (const tx of transactions) {
    const key = tx.createdAt.toISOString().split('T')[0];
    if (dailyMap[key] !== undefined) {
      dailyMap[key] += tx[valueKey] ?? 0;
    }
  }

  return Object.entries(dailyMap).map(([date, amount]) => ({ date, amount }));
}

export function buildDailyChartForRange(transactions, dateFrom, dateTo, valueKey = 'ownerCreditXaf') {
  const dailyMap = {};
  const cursor = new Date(dateFrom);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(dateTo);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    dailyMap[cursor.toISOString().split('T')[0]] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const tx of transactions) {
    const key = tx.createdAt.toISOString().split('T')[0];
    if (dailyMap[key] !== undefined) {
      dailyMap[key] += tx[valueKey] ?? 0;
    }
  }

  return Object.entries(dailyMap).map(([date, amount]) => ({ date, amount }));
}
