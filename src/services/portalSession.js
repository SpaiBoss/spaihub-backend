import prisma from '../utils/prisma.js';

export async function findActiveSession(routerId, { deviceId, phone, mac }) {
  const now = new Date();
  const baseWhere = {
    routerId,
    status: 'SUCCESS',
    sessionEnd: { gt: now },
  };

  const sessionSelect = {
    id: true,
    deviceId: true,
    sessionEnd: true,
    sessionStart: true,
    subscriberMac: true,
    subscriberPhone: true,
    routerId: true,
    hotspotUsername: true,
    hotspotPin: true,
    package: {
      select: {
        name: true,
        dataCapMb: true,
        durationMinutes: true,
      },
    },
  };

  if (deviceId) {
    const byDevice = await prisma.transaction.findFirst({
      where: { ...baseWhere, deviceId },
      select: sessionSelect,
      orderBy: { sessionEnd: 'desc' },
    });
    if (byDevice) return byDevice;
  }

  if (phone && phone !== 'VOUCHER') {
    const byPhone = await prisma.transaction.findFirst({
      where: { ...baseWhere, subscriberPhone: phone },
      select: sessionSelect,
      orderBy: { sessionEnd: 'desc' },
    });
    if (byPhone) return byPhone;
  }

  if (mac) {
    return prisma.transaction.findFirst({
      where: { ...baseWhere, subscriberMac: mac },
      select: sessionSelect,
      orderBy: { sessionEnd: 'desc' },
    });
  }

  return null;
}

export function sessionResponse(session) {
  return {
    active: true,
    sessionEnd: session.sessionEnd,
    packageName: session.package.name,
    dataCapMb: session.package.dataCapMb,
    hotspotUsername: session.hotspotUsername,
    hotspotPin: session.hotspotPin,
  };
}
