import prisma from '../utils/prisma.js';
import { resolvePackageAccessLimits, normalizeMaxSharedDevices } from '../utils/packageAccess.js';
import { normalizeMac } from '../utils/deviceId.js';
import { normalizeCameroonMobileLocal } from '../utils/phone.js';
import * as mikrotik from './mikrotik.js';
import logger from '../utils/logger.js';

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
  macBindCount: true,
  package: {
    select: {
      name: true,
      type: true,
      dataCapMb: true,
      durationMinutes: true,
      maxSharedDevices: true,
    },
  },
};

export async function findActiveSession(routerId, { deviceId, phone, mac }) {
  const now = new Date();
  const baseWhere = {
    routerId,
    status: 'SUCCESS',
    sessionEnd: { gt: now },
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

/**
 * Keep portal device id and MAC in sync when phones rotate MAC addresses or browsers reset storage.
 * Single-device sessions: allow one MikroTik MAC rebind (macBindCount < 2).
 */
export async function syncSessionIdentity(session, { deviceId, mac } = {}) {
  if (!session?.id) return session;

  const nextDeviceId = deviceId?.trim() || null;
  const nextMac = mac ? normalizeMac(mac) : null;
  const updates = {};

  if (nextDeviceId && nextDeviceId !== session.deviceId) {
    updates.deviceId = nextDeviceId;
  }

  const macChanged = Boolean(nextMac && nextMac !== session.subscriberMac);
  if (macChanged) {
    updates.subscriberMac = nextMac;
  }

  const sharedUsers = normalizeMaxSharedDevices(session.package?.maxSharedDevices);
  const canRebind =
    macChanged &&
    sharedUsers === 1 &&
    session.hotspotUsername &&
    session.routerId &&
    (session.macBindCount ?? 0) < 2;

  if (canRebind) {
    updates.macBindCount = (session.macBindCount ?? 0) + 1;
  }

  if (Object.keys(updates).length === 0) {
    return session;
  }

  const updated = await prisma.transaction.update({
    where: { id: session.id },
    data: updates,
    select: sessionSelect,
  });

  if (canRebind) {
    try {
      await mikrotik.rebindMac({
        routerId: session.routerId,
        username: session.hotspotUsername,
        macAddress: nextMac,
      });
    } catch (err) {
      logger.warn('MAC rebind queue failed', {
        transactionId: session.id,
        error: err.message,
      });
    }
  }

  return updated;
}

export function sessionResponse(session) {
  const access = resolvePackageAccessLimits(session.package);

  return {
    active: true,
    sessionEnd: session.sessionEnd,
    packageName: session.package.name,
    packageType: access.packageType,
    maxSharedDevices: session.package.maxSharedDevices ?? 1,
    dataCapMb:
      access.packageType === 'DATA_BASED' && access.applyByteLimit ? access.dataCapMb : null,
    durationMinutes: session.package.durationMinutes,
    hotspotUsername: session.hotspotUsername,
    hotspotPin: session.hotspotPin,
  };
}
