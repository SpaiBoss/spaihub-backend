import prisma from '../utils/prisma.js';
import { resolvePackageAccessLimits } from '../utils/packageAccess.js';
import { normalizeMac } from '../utils/deviceId.js';
import { normalizeCameroonMobileLocal } from '../utils/phone.js';

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
        type: true,
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

  const normalizedPhone = phone && phone !== 'VOUCHER' ? normalizeCameroonMobileLocal(phone) : null;

  if (normalizedPhone) {
    const byPhone = await prisma.transaction.findFirst({
      where: { ...baseWhere, subscriberPhone: normalizedPhone },
      select: sessionSelect,
      orderBy: { sessionEnd: 'desc' },
    });
    if (byPhone) return byPhone;
  }

  const normalizedMac = mac ? normalizeMac(mac) : null;
  if (normalizedMac) {
    return prisma.transaction.findFirst({
      where: { ...baseWhere, subscriberMac: normalizedMac },
      select: sessionSelect,
      orderBy: { sessionEnd: 'desc' },
    });
  }

  return null;
}

/** Keep portal device id and MAC in sync when phones rotate MAC addresses or browsers reset storage. */
export async function syncSessionIdentity(session, { deviceId, mac } = {}) {
  if (!session?.id) return session;

  const nextDeviceId = deviceId?.trim() || null;
  const nextMac = mac ? normalizeMac(mac) : null;
  const updates = {};

  if (nextDeviceId && nextDeviceId !== session.deviceId) {
    updates.deviceId = nextDeviceId;
  }
  if (nextMac && nextMac !== session.subscriberMac) {
    updates.subscriberMac = nextMac;
  }

  if (Object.keys(updates).length === 0) {
    return session;
  }

  return prisma.transaction.update({
    where: { id: session.id },
    data: updates,
    select: {
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
          type: true,
          dataCapMb: true,
          durationMinutes: true,
        },
      },
    },
  });
}

export function sessionResponse(session) {
  const access = resolvePackageAccessLimits(session.package);

  return {
    active: true,
    sessionEnd: session.sessionEnd,
    packageName: session.package.name,
    packageType: access.packageType,
    dataCapMb:
      access.packageType === 'DATA_BASED' && access.applyByteLimit ? access.dataCapMb : null,
    durationMinutes: session.package.durationMinutes,
    hotspotUsername: session.hotspotUsername,
    hotspotPin: session.hotspotPin,
  };
}
