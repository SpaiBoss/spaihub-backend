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

  if (totalLimit <= 1 && activeDeviceCount >= 1 && !location.allowHotspotSharing) {
    return {
      ok: false,
      error: 'Hotspot sharing is disabled. Only one device can use each access code.',
    };
  }

  if (totalLimit <= 1 && activeDeviceCount >= 1 && location.allowHotspotSharing) {
    const hotspotLimit = Math.max(0, Number(location.maxHotspotDevices) || 0);
    const secondaryDevices = activeDeviceCount;
    if (secondaryDevices > hotspotLimit) {
      return {
        ok: false,
        error:
          hotspotLimit === 0
            ? 'Hotspot sharing is enabled but no hotspot devices are allowed per access code'
            : `Maximum of ${hotspotLimit} hotspot device${hotspotLimit === 1 ? '' : 's'} allowed per access code`,
      };
    }
  }

  return { ok: true };
}

export function parseAccessPolicyInput(body) {
  const data = {};

  if (body.allowHotspotSharing !== undefined) {
    data.allowHotspotSharing = Boolean(body.allowHotspotSharing);
  }

  if (body.maxHotspotDevices !== undefined) {
    const value = Number(body.maxHotspotDevices);
    if (!Number.isInteger(value) || value < 0) {
      return { error: 'maxHotspotDevices must be a non-negative integer' };
    }
    data.maxHotspotDevices = value;
  }

  if (body.maxDevicesPerAccessCode !== undefined) {
    const value = Number(body.maxDevicesPerAccessCode);
    if (!Number.isInteger(value) || value < 0) {
      return { error: 'maxDevicesPerAccessCode must be a non-negative integer' };
    }
    data.maxDevicesPerAccessCode = value;
  }

  return { data };
}
