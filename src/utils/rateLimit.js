/**
 * Platform-wide hotspot bandwidth helpers.
 * Upload limits remain per-package; download cap applies to every SpaiHub subscriber.
 */

/**
 * Convert megabytes per second to MikroTik rate-limit megabits (RouterOS "M" suffix).
 * Returns "0" for unlimited.
 */
export function mbPerSecToMikrotikMbit(mbPerSec) {
  const value = Number(mbPerSec);
  if (!value || value <= 0) return '0';
  return String(Math.round(value * 8));
}

/**
 * Global download speed cap for all SpaiHub hotspot users (MB/s).
 * Set HOTSPOT_DOWNLOAD_SPEED_MB_PER_SEC=0 to disable (unlimited download).
 * Default: 3 MB/s when env is unset.
 */
export function getPlatformDownloadSpeedMbPerSec() {
  const raw = process.env.HOTSPOT_DOWNLOAD_SPEED_MB_PER_SEC;
  if (raw === '0') return null;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(100, Math.round(n));
  }
  return 3;
}

/**
 * Build MikroTik hotspot profile rate-limit: upload/download from the user's perspective.
 * Download "0" on MikroTik means unlimited.
 */
export function buildMikrotikRateLimit(uploadSpeedMbPerSec, downloadSpeedMbPerSec) {
  const upload = mbPerSecToMikrotikMbit(uploadSpeedMbPerSec || 1);
  const downloadMb = downloadSpeedMbPerSec ?? getPlatformDownloadSpeedMbPerSec();
  const download = mbPerSecToMikrotikMbit(downloadMb);
  const downloadPart = download === '0' ? '0' : `${download}M`;
  return `${upload}M/${downloadPart}`;
}
