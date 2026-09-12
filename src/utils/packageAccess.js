/**
 * Resolve MikroTik access limits from a package record.
 * TIME_BASED: limit-uptime only, unless owner enabled optional data cap (dataCapMb set).
 * DATA_BASED: limit-bytes-total from dataCapMb + expiry via limit-uptime.
 * Download speed is platform-wide (see HOTSPOT_DOWNLOAD_SPEED_MB_PER_SEC).
 */
import { getPlatformDownloadSpeedMbPerSec } from './rateLimit.js';

/** Clamp package shared-device count for MikroTik shared-users. */
export function normalizeMaxSharedDevices(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(20, Math.round(n));
}

/**
 * MAC cookie lifetime in minutes: never shorter than 15m, never longer than
 * the paid session window, and never longer than 1 day.
 */
export function resolveMacCookieMinutes(sessionMinutes) {
  const session = Math.max(0, Number(sessionMinutes) || 0);
  if (session <= 0) return 60;
  return Math.min(24 * 60, Math.max(15, Math.round(session)));
}

export function resolvePackageAccessLimits(pkg) {
  const sessionMinutes = Number(pkg.durationMinutes) || 0;
  const uploadSpeedMbPerSec = Number(pkg.uploadSpeedMbPerSec) || 1;
  const downloadSpeedMbPerSec = getPlatformDownloadSpeedMbPerSec();
  const sharedUsers = normalizeMaxSharedDevices(pkg.maxSharedDevices);
  const macCookieMinutes = resolveMacCookieMinutes(sessionMinutes);
  const type = pkg.type || 'TIME_BASED';

  if (type === 'DATA_BASED') {
    return {
      packageType: type,
      sessionMinutes,
      dataCapMb: pkg.dataCapMb ?? null,
      uploadSpeedMbPerSec,
      downloadSpeedMbPerSec,
      sharedUsers,
      macCookieMinutes,
      applyByteLimit: !!(pkg.dataCapMb && pkg.dataCapMb > 0),
    };
  }

  const optionalCap =
    pkg.dataCapMb != null && Number(pkg.dataCapMb) > 0 ? Number(pkg.dataCapMb) : null;

  return {
    packageType: type,
    sessionMinutes,
    dataCapMb: optionalCap,
    uploadSpeedMbPerSec,
    downloadSpeedMbPerSec,
    sharedUsers,
    macCookieMinutes,
    applyByteLimit: optionalCap != null,
  };
}

/** Normalize dataCapMb on create/update — TIME_BASED defaults to unlimited (null). */
export function normalizePackageDataCap(type, dataCapMb) {
  if (type === 'DATA_BASED') {
    const cap = dataCapMb != null ? Number(dataCapMb) : null;
    return cap && cap > 0 ? cap : null;
  }

  if (dataCapMb == null || dataCapMb === '' || dataCapMb === false) {
    return null;
  }

  const cap = Number(dataCapMb);
  return cap > 0 ? cap : null;
}
