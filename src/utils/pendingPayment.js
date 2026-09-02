/** Campay collect requests older than this are marked failed so users can retry. */
export const PENDING_PAYMENT_MAX_AGE_MS = 15 * 60 * 1000;

export function normalizeCampayStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'SUCCESSFUL' || value === 'SUCCESS') return 'SUCCESSFUL';
  if (value === 'FAILED' || value === 'CANCELLED' || value === 'CANCELED') return 'FAILED';
  return 'PENDING';
}

export async function expireStalePendingPayments(prisma, routerId, deviceId) {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_MAX_AGE_MS);
  await prisma.transaction.updateMany({
    where: {
      routerId,
      ...(deviceId ? { deviceId: deviceId.trim() } : {}),
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    data: { status: 'FAILED' },
  });
}

export function findDevicePendingPayment(prisma, routerId, deviceId) {
  return prisma.transaction.findFirst({
    where: {
      routerId,
      deviceId: deviceId.trim(),
      status: 'PENDING',
      campayReference: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      package: { select: { id: true, name: true, type: true, dataCapMb: true, durationMinutes: true } },
    },
  });
}
