import prisma from '../utils/prisma.js';
import { normalizeMaxSharedDevices } from '../utils/packageAccess.js';

/** 0 means one device per access code (owner default). */
export function effectiveAccessDeviceLimit(maxDevicesPerAccessCode) {
  const value = Number(maxDevicesPerAccessCode) || 0;
  return value <= 0 ? 1 : value;
}

export async function getActiveVoucherSessions(voucherId) {
  const now = new Date();
  return prisma.transaction.findMany({
    where: {
      voucherId,
      status: 'SUCCESS',
      sessionEnd: { gt: now },
    },
    select: { id: true, deviceId: true, sessionEnd: true, subscriberMac: true, routerId: true },
    orderBy: { sessionStart: 'asc' },
  });
}

/**
 * Enforce simultaneous-device limits from package maxSharedDevices (preferred)
 * or location maxDevicesPerAccessCode fallback. Location hotspot-sharing toggles
 * are ignored — they cannot see devices behind NAT and misled owners.
 */
export function validateAccessPolicy(location, { activeDeviceCount, isExistingDevice, deviceLimit }) {
  if (isExistingDevice) {
    return { ok: true };
  }

  const totalLimit =
    deviceLimit != null
      ? normalizeMaxSharedDevices(deviceLimit)
      : effectiveAccessDeviceLimit(location.maxDevicesPerAccessCode);

  if (activeDeviceCount >= totalLimit) {
    return {
      ok: false,
      error:
        totalLimit === 1
          ? 'This access code is already in use on another device'
          : `This access code is already in use on the maximum of ${totalLimit} devices`,
    };
  }

  return { ok: true };
}

export function parseAccessPolicyInput(body) {
  const data = {};

  if (body.maxDevicesPerAccessCode !== undefined) {
    const value = Number(body.maxDevicesPerAccessCode);
    if (!Number.isInteger(value) || value < 0) {
      return { error: 'maxDevicesPerAccessCode must be a non-negative integer' };
    }
    data.maxDevicesPerAccessCode = value;
  }

  // Accept but ignore legacy hotspot-sharing fields so old clients do not error
  if (body.allowHotspotSharing !== undefined || body.maxHotspotDevices !== undefined) {
    // no-op: columns retained; package maxSharedDevices is the source of truth
  }

  return { data };
}
