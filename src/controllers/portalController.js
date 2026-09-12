import prisma from '../utils/prisma.js';
import * as campay from '../services/campay.js';
import * as mikrotik from '../services/mikrotik.js';
import { completePaidSession } from '../services/session.js';
import { findActiveSession, sessionResponse, syncSessionIdentity } from '../services/portalSession.js';
import { endHotspotSession } from '../services/sessionLifecycle.js';
import { buildMikrotikLoginHtml, buildMikrotikStatusHtml } from '../services/mikrotikScripts.js';
import { isValidDeviceId, normalizeMac } from '../utils/deviceId.js';
import { normalizeCameroonMobileLocal, toCampayPhone } from '../utils/phone.js';
import {
  getActiveVoucherSessions,
  validateAccessPolicy,
} from '../services/accessPolicy.js';
import { resolvePortalBranding, brandingSelectFields } from '../utils/portalBranding.js';
import { resolvePackageAccessLimits, normalizeMaxSharedDevices } from '../utils/packageAccess.js';
import {
  expireStalePendingPayments,
  findAnyPendingPayment,
  findDevicePendingPayment,
  normalizeCampayStatus,
} from '../utils/pendingPayment.js';
import { logMetric } from '../services/walletLedger.js';
import { notifyPaymentConfirmed } from '../services/whatsappNotify.js';
import { disconnectDeviceOnly } from '../services/sessionLifecycle.js';
import { getPlatformFeePercent } from '../utils/platformConfig.js';

function portalAccessError(router) {
  if (!router) {
    return { status: 404, error: 'Router not found' };
  }
  if (router.location.owner.status !== 'ACTIVE') {
    return {
      status: 403,
      error: 'This hotspot is temporarily unavailable. Contact the location owner.',
    };
  }
  if (!router.location.isActive) {
    return {
      status: 403,
      error: 'This location is not accepting new connections right now.',
    };
  }
  return null;
}

async function loadPortalRouter(routerToken, { includePackages = false } = {}) {
  return prisma.router.findFirst({
    where: { routerToken, isActive: true },
    include: {
      location: {
        include: {
          owner: { select: { status: true, ...brandingSelectFields() } },
          ...(includePackages
            ? { packages: { where: { isActive: true }, orderBy: { priceXaf: 'asc' } } }
            : {}),
        },
      },
    },
  });
}

function normalizeVoucherCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normalizePin(pin) {
  return String(pin || '').trim();
}

async function provisionHotspotUser({ routerId, location, pkg, username, password, macAddress = null }) {
  const access = resolvePackageAccessLimits(pkg);
  const bindMac = access.sharedUsers === 1 && macAddress ? macAddress : null;

  await mikrotik.grantAccess({
    routerId,
    username,
    password,
    sessionMinutes: access.sessionMinutes,
    packageType: access.packageType,
    dataCapMb: access.applyByteLimit ? access.dataCapMb : null,
    uploadSpeedMbPerSec: access.uploadSpeedMbPerSec,
    downloadSpeedMbPerSec: access.downloadSpeedMbPerSec,
    sharedUsers: access.sharedUsers,
    macCookieMinutes: access.macCookieMinutes,
    macAddress: bindMac,
  });
}

export async function getPortal(req, res, next) {
  try {
    const { routerToken } = req.params;

    const router = await loadPortalRouter(routerToken, { includePackages: true });
    const accessError = portalAccessError(router);
    if (accessError) {
      return res.status(accessError.status).json({ error: accessError.error });
    }

    const branding = resolvePortalBranding(router.location.owner, req);
    const packages = router.location.packages.map((pkg) => {
      const { uploadSpeedMbPerSec, dataCapMb, ...rest } = pkg;
      const publicPkg =
        pkg.type === 'TIME_BASED'
          ? { ...rest, type: pkg.type }
          : { ...rest, type: pkg.type, dataCapMb };
      if (branding.showUploadSpeed) {
        return { ...publicPkg, uploadSpeedMbPerSec };
      }
      return publicPkg;
    });

    res.json({
      locationName: router.location.name,
      routerStatus: router.status,
      packages,
      branding,
    });
  } catch (err) {
    next(err);
  }
}

/** HTML redirect page for MikroTik hotspot/login.html (fetched by setup script). */
export async function getMikrotikLoginHtml(req, res, next) {
  try {
    const { routerToken } = req.params;
    const router = await loadPortalRouter(routerToken);
    const accessError = portalAccessError(router);
    if (accessError) {
      return res.status(accessError.status).type('text/plain').send(accessError.error);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildMikrotikLoginHtml(routerToken));
  } catch (err) {
    next(err);
  }
}

/** Branded hotspot/status.html (fetched by setup script; MikroTik substitutes macros). */
export async function getMikrotikStatusHtml(req, res, next) {
  try {
    const { routerToken } = req.params;
    const router = await loadPortalRouter(routerToken);
    const accessError = portalAccessError(router);
    if (accessError) {
      return res.status(accessError.status).type('text/plain').send(accessError.error);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildMikrotikStatusHtml());
  } catch (err) {
    next(err);
  }
}

export async function checkSession(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, mac, phone } = req.query;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const normalizedMac = normalizeMac(mac);
    const localPhone = normalizeCameroonMobileLocal(phone);
    const session = await findActiveSession(router.id, {
      deviceId: deviceId.trim(),
      phone: localPhone,
      mac: normalizedMac,
    });

    if (!session) {
      return res.json({ active: false });
    }

    const synced = await syncSessionIdentity(session, {
      deviceId: deviceId.trim(),
      mac: normalizedMac,
    });

    res.json(sessionResponse(synced));
  } catch (err) {
    next(err);
  }
}

export async function logoutSession(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, mac, phone } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const normalizedMac = normalizeMac(mac);
    const localPhone = normalizeCameroonMobileLocal(phone);
    const session = await findActiveSession(router.id, {
      deviceId: deviceId.trim(),
      phone: localPhone,
      mac: normalizedMac,
    });

    if (!session) {
      return res.json({ message: 'No active session', active: false });
    }

    await endHotspotSession(session);

    res.json({ message: 'Logged out', active: false });
  } catch (err) {
    next(err);
  }
}

export async function initiatePayment(req, res, next) {
  let transactionId = null;

  try {
    const { routerToken } = req.params;
    const { packageId, phoneNumber, macAddress, deviceId } = req.body;

    if (!packageId || !phoneNumber || !isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'packageId, phoneNumber, and deviceId are required' });
    }

    const localPhone = normalizeCameroonMobileLocal(phoneNumber);
    if (!localPhone) {
      return res.status(400).json({ error: 'Enter a valid Cameroon mobile number (e.g. 677123456)' });
    }

    const campayPhone = toCampayPhone(localPhone);
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
    if (!frontendUrl) {
      return res.status(503).json({ error: 'Payment service is temporarily unavailable' });
    }

    const normalizedMac = normalizeMac(macAddress);

    const router = await loadPortalRouter(routerToken);
    const accessError = portalAccessError(router);
    if (accessError) {
      return res.status(accessError.status).json({ error: accessError.error });
    }

    if (router.status === 'OFFLINE') {
      return res.status(503).json({
        error: 'This hotspot router is offline. Payment is unavailable until the router reconnects.',
      });
    }

    if (router.status === 'DEGRADED') {
      return res.status(503).json({
        error: 'This hotspot router is having connectivity issues. Payment may be delayed — try again shortly.',
      });
    }

    const pkg = await prisma.package.findFirst({
      where: { id: packageId, locationId: router.locationId, isActive: true },
    });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const trimmedDeviceId = deviceId.trim();
    const activeSession = await findActiveSession(router.id, {
      deviceId: trimmedDeviceId,
      phone: localPhone,
      mac: normalizedMac,
    });
    if (activeSession) {
      const synced = await syncSessionIdentity(activeSession, {
        deviceId: trimmedDeviceId,
        mac: normalizedMac,
      });
      const recoveredByPhone =
        activeSession.subscriberPhone === localPhone && activeSession.deviceId !== trimmedDeviceId;
      return res.status(409).json({
        error: recoveredByPhone
          ? 'This number already has an active WiFi session. Your credentials are shown below — use Connect to WiFi if you were disconnected.'
          : 'You already have an active session on this network.',
        recoverSession: true,
        ...sessionResponse(synced),
      });
    }

    await expireStalePendingPayments(prisma, router.id, trimmedDeviceId);

    const pendingPayment = await findAnyPendingPayment(prisma, router.id, {
      deviceId: trimmedDeviceId,
      subscriberPhone: localPhone,
    });
    if (pendingPayment) {
      if (pendingPayment.packageId === pkg.id) {
        return res.json({
          reference: pendingPayment.campayReference,
          resumed: true,
          message: 'Resuming your pending payment. Approve MoMo on your phone.',
          phone: pendingPayment.subscriberPhone,
          packageId: pendingPayment.packageId,
        });
      }

      await prisma.transaction.update({
        where: { id: pendingPayment.id },
        data: { status: 'FAILED' },
      });
    }

    const platformFeeXaf = Math.floor(pkg.priceXaf * (getPlatformFeePercent() / 100));
    const ownerCreditXaf = pkg.priceXaf - platformFeeXaf;

    const transaction = await prisma.transaction.create({
      data: {
        ownerId: router.location.ownerId,
        locationId: router.locationId,
        routerId: router.id,
        packageId: pkg.id,
        subscriberPhone: localPhone,
        subscriberMac: normalizedMac,
        deviceId: deviceId.trim(),
        amountXaf: pkg.priceXaf,
        platformFeeXaf,
        ownerCreditXaf,
        status: 'PENDING',
      },
    });
    transactionId = transaction.id;

    const redirectBase = `${frontendUrl}/portal/${routerToken}`;
    const redirectParams = new URLSearchParams();
    if (normalizedMac) redirectParams.set('mac', normalizedMac);
    const redirectUrl = redirectParams.toString()
      ? `${redirectBase}?${redirectParams}`
      : redirectBase;

    const payment = await campay.initiatePayment({
      amount: pkg.priceXaf,
      from: campayPhone,
      description: `${pkg.name} - ${router.location.name}`,
      externalReference: transaction.id,
      redirectUrl,
    });

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { campayReference: payment.reference },
    });

    res.json({
      reference: payment.reference,
      message: 'Approve the payment on your phone',
      operator: payment.operator,
    });
  } catch (err) {
    if (transactionId) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'FAILED' },
      }).catch(() => {});
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

async function performVoucherRedeem({ routerToken, code, pin, macAddress, deviceId }) {
  if (!code?.trim() || !pin?.trim() || !isValidDeviceId(deviceId)) {
    return { ok: false, status: 400, error: 'Voucher code, PIN, and deviceId are required' };
  }

  const normalizedMac = normalizeMac(macAddress);
  const normalizedPin = normalizePin(pin);

  const router = await loadPortalRouter(routerToken);
  const accessError = portalAccessError(router);
  if (accessError) {
    return { ok: false, status: accessError.status, error: accessError.error };
  }

  const normalizedCode = normalizeVoucherCode(code);
  const voucher = await prisma.voucher.findUnique({
    where: { code: normalizedCode },
    include: { package: true },
  });

  if (!voucher) {
    return { ok: false, status: 404, error: 'Invalid voucher code' };
  }

  if (!voucher.pin) {
    return {
      ok: false,
      status: 400,
      error: 'This voucher has no PIN. Contact the location owner for a new voucher.',
    };
  }

  if (voucher.pin !== normalizedPin) {
    return { ok: false, status: 400, error: 'Invalid PIN' };
  }

  if (voucher.locationId !== router.locationId) {
    return { ok: false, status: 400, error: 'This voucher is not valid at this location' };
  }

  if (voucher.status === 'REVOKED') {
    return { ok: false, status: 400, error: 'This voucher has been revoked' };
  }

  if (voucher.status === 'EXPIRED' || (voucher.expiresAt && voucher.expiresAt < new Date())) {
    if (voucher.status === 'UNUSED') {
      await prisma.voucher.update({ where: { id: voucher.id }, data: { status: 'EXPIRED' } });
    }
    return { ok: false, status: 400, error: 'This voucher has expired' };
  }

  const trimmedDeviceId = deviceId.trim();
  const activeSessions = await getActiveVoucherSessions(voucher.id);
  const isExistingDevice = activeSessions.some((session) => session.deviceId === trimmedDeviceId);

  if (voucher.status === 'REDEEMED' && activeSessions.length === 0) {
    return { ok: false, status: 400, error: 'This voucher has already been used' };
  }

  if (voucher.status !== 'UNUSED' && voucher.status !== 'REDEEMED') {
    return { ok: false, status: 400, error: 'This voucher is not available' };
  }

  const policyCheck = validateAccessPolicy(router.location, {
    activeDeviceCount: activeSessions.length,
    isExistingDevice,
    deviceLimit: voucher.package.maxSharedDevices,
  });

  if (!policyCheck.ok) {
    return { ok: false, status: 400, error: policyCheck.error };
  }

  const hotspotUsername = voucher.code;
  const hotspotPin = voucher.pin;

  if (isExistingDevice) {
    const existingSession = activeSessions.find((session) => session.deviceId === trimmedDeviceId);
    const synced = await syncSessionIdentity(existingSession, {
      deviceId: trimmedDeviceId,
      mac: normalizedMac,
    });

    return {
      ok: true,
      message: 'Already connected',
      sessionEnd: synced.sessionEnd,
      packageName: voucher.package.name,
      hotspotUsername,
      hotspotPin,
    };
  }

  const sessionByMac =
    normalizedMac && activeSessions.find((session) => session.subscriberMac === normalizedMac);
  if (sessionByMac) {
    const synced = await syncSessionIdentity(sessionByMac, {
      deviceId: trimmedDeviceId,
      mac: normalizedMac,
    });

    return {
      ok: true,
      message: 'Already connected',
      sessionEnd: synced.sessionEnd,
      packageName: voucher.package.name,
      hotspotUsername,
      hotspotPin,
    };
  }

  const now = new Date();
  const sessionEnd = new Date(now.getTime() + voucher.package.durationMinutes * 60 * 1000);

  await prisma.$transaction(
    async (tx) => {
      const locked = await tx.voucher.findUnique({ where: { id: voucher.id } });
      if (!locked || (locked.status !== 'UNUSED' && locked.status !== 'REDEEMED')) {
        throw Object.assign(new Error('Voucher is no longer available'), { statusCode: 409 });
      }

      await tx.transaction.create({
        data: {
          ownerId: router.location.ownerId,
          locationId: router.locationId,
          routerId: router.id,
          packageId: voucher.packageId,
          voucherId: voucher.id,
          subscriberPhone: 'VOUCHER',
          subscriberMac: normalizedMac,
          deviceId: trimmedDeviceId,
          hotspotUsername,
          hotspotPin,
          amountXaf: 0,
          platformFeeXaf: 0,
          ownerCreditXaf: 0,
          status: 'SUCCESS',
          sessionStart: now,
          sessionEnd,
          macBindCount:
            normalizeMaxSharedDevices(voucher.package.maxSharedDevices) === 1 && normalizedMac
              ? 1
              : 0,
        },
      });

      await tx.voucher.update({
        where: { id: voucher.id },
        data: {
          status: 'REDEEMED',
          redeemedAt: locked.redeemedAt ?? now,
          redeemedMac: normalizedMac ?? locked.redeemedMac,
          routerId: router.id,
        },
      });
    },
    { isolationLevel: 'Serializable' }
  );

  await provisionHotspotUser({
    routerId: router.id,
    location: router.location,
    pkg: voucher.package,
    username: hotspotUsername,
    password: hotspotPin,
    macAddress: normalizedMac,
  });

  return {
    ok: true,
    message: 'Voucher redeemed successfully',
    sessionEnd,
    packageName: voucher.package.name,
    hotspotUsername,
    hotspotPin,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLinkLoginUrl(linkLogin, username, password) {
  if (!linkLogin || !username || !password) return null;
  if (linkLogin.includes('$(')) return null;
  try {
    const url = new URL(linkLogin);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    return url.toString();
  } catch {
    const separator = linkLogin.includes('?') ? '&' : '?';
    return `${linkLogin}${separator}username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }
}

function captiveHtmlShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#0E141B;color:#fff;padding:1.25rem;text-align:center}
  a{color:#5eead4}
  .btn{display:inline-block;margin-top:1rem;padding:0.85rem 1.25rem;background:#0F766E;color:#fff;
    text-decoration:none;border-radius:0.5rem;font-weight:600}
  .err{color:#fca5a5}
  .muted{opacity:0.7;font-size:0.9rem}
</style>
</head>
<body><div>${bodyHtml}</div></body>
</html>`;
}

function buildRedeemSuccessHtml(connectUrl, result) {
  const user = escapeHtml(result.hotspotUsername);
  const pin = escapeHtml(result.hotspotPin);
  const pkg = escapeHtml(result.packageName || 'Access ready');

  if (connectUrl) {
    const href = escapeHtml(connectUrl);
    // Do NOT auto-redirect HTTPS → http://router (captive WebViews block it and look like "nothing happened").
    // Require a tap so navigation is a user gesture.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access ready</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#0E141B;color:#fff;padding:1.25rem;text-align:center}
  .btn{display:inline-block;margin-top:1.25rem;padding:0.95rem 1.35rem;background:#0F766E;color:#fff;
    text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1.05rem}
  .muted{opacity:0.7;font-size:0.9rem;margin:0.5rem 0 0}
  .creds{margin-top:1.25rem;padding:0.85rem;border:1px solid #2a3441;border-radius:0.5rem;text-align:left;font-size:0.85rem}
  .creds strong{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
</style>
</head>
<body>
<div>
<h1>Access ready</h1>
<p class="muted">${pkg}</p>
<p class="muted">Wait ~20 seconds for the router to import access, then tap Connect. Your username and PIN stay on this page.</p>
<p><a class="btn" href="${href}">Connect to WiFi now</a></p>
<div class="creds">
  <div>Username: <strong>${user}</strong></div>
  <div style="margin-top:0.35rem">PIN: <strong>${pin}</strong></div>
</div>
<p class="muted">If connect fails, wait a few seconds and tap again.</p>
</div>
</body>
</html>`;
  }

  return captiveHtmlShell(
    'Voucher ready',
    `<h1>Voucher ready</h1>
<p class="muted">${pkg}</p>
<p class="muted">Enter these on the hotspot login page:</p>
<p>Username: <strong>${user}</strong><br>PIN: <strong>${pin}</strong></p>
<p class="muted"><a href="javascript:history.back()">Back</a></p>`
  );
}

function buildRedeemErrorHtml(error) {
  return captiveHtmlShell(
    'Redeem failed',
    `<h1 class="err">Could not redeem</h1>
<p>${escapeHtml(error)}</p>
<p><a class="btn" href="javascript:history.back()">Try again</a></p>`
  );
}

export async function redeemVoucher(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { code, pin, macAddress, deviceId } = req.body;

    const result = await performVoucherRedeem({
      routerToken,
      code,
      pin,
      macAddress,
      deviceId,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({
      message: result.message,
      sessionEnd: result.sessionEnd,
      packageName: result.packageName,
      hotspotUsername: result.hotspotUsername,
      hotspotPin: result.hotspotPin,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

/** Form POST from MikroTik login.html — returns HTML redirect to link-login (no SPA / CORS). */
export async function redeemConnect(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { routerToken } = req.params;
    const body = req.body || {};
    let deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!isValidDeviceId(deviceId)) {
      // Captive WebViews often block JS/localStorage — mint a device id server-side.
      deviceId = crypto.randomUUID();
    }

    const result = await performVoucherRedeem({
      routerToken,
      code: body.code,
      pin: body.pin,
      macAddress: body.macAddress || body.mac,
      deviceId,
    });

    res.type('html');

    if (!result.ok) {
      return res.status(result.status).send(buildRedeemErrorHtml(result.error));
    }

    const connectUrl = buildLinkLoginUrl(
      body.linkLogin || body['link-login'] || body['link-login-only'],
      result.hotspotUsername,
      result.hotspotPin
    );
    return res.send(buildRedeemSuccessHtml(connectUrl, result));
  } catch (err) {
    // Always HTML for this endpoint — never fall through to JSON error middleware.
    const message = err.statusCode ? err.message : 'Something went wrong. Go back and try again.';
    const status = err.statusCode || 500;
    return res.status(status).type('html').send(buildRedeemErrorHtml(message));
  }
}

export async function processCampayStatus(reference, status) {
  const normalizedStatus = normalizeCampayStatus(status);
  const transaction = await prisma.transaction.findUnique({
    where: { campayReference: reference },
    include: { package: true, location: true },
  });

  if (!transaction) return null;

  if (transaction.status === 'SUCCESS') {
    return transaction;
  }

  if (normalizedStatus === 'SUCCESSFUL') {
    if (transaction.status === 'FAILED') {
      const conflict = await prisma.transaction.findFirst({
        where: {
          routerId: transaction.routerId,
          subscriberPhone: transaction.subscriberPhone,
          status: 'SUCCESS',
          sessionEnd: { gt: new Date() },
          id: { not: transaction.id },
        },
      });
      if (conflict) {
        return transaction;
      }

      const reopened = await prisma.transaction.updateMany({
        where: { id: transaction.id, status: 'FAILED' },
        data: { status: 'PENDING' },
      });
      if (reopened.count === 0) {
        return transaction;
      }
      transaction.status = 'PENDING';
      logMetric('payment_orphan_recovered', { transactionId: transaction.id, reference });
    }

    if (transaction.status !== 'PENDING') {
      return transaction;
    }

    await prisma.$transaction(async (tx) => {
      await completePaidSession(tx, {
        transaction,
        pkg: transaction.package,
        routerId: transaction.routerId,
        location: transaction.location,
      });
    });

    const completed = await prisma.transaction.findFirst({
      where: { id: transaction.id },
      include: {
        package: { select: { name: true, type: true, dataCapMb: true, durationMinutes: true } },
      },
    });

    if (completed?.status === 'SUCCESS') {
      notifyPaymentConfirmed(completed).catch(() => {});
    }

    return completed;
  }

  if (normalizedStatus === 'FAILED') {
    await prisma.transaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    return prisma.transaction.findUnique({ where: { id: transaction.id } });
  }

  return transaction;
}

export async function checkPaymentStatus(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { reference, deviceId } = req.query;

    if (!reference?.trim() || !isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'reference and deviceId are required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const transaction = await prisma.transaction.findFirst({
      where: {
        campayReference: reference.trim(),
        routerId: router.id,
        deviceId: deviceId.trim(),
      },
      include: { package: { select: { name: true, type: true, dataCapMb: true, durationMinutes: true } } },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (transaction.status === 'SUCCESS') {
      return res.json({
        status: 'SUCCESS',
        ...sessionResponse({
          ...transaction,
          package: transaction.package,
          sessionEnd: transaction.sessionEnd,
        }),
      });
    }

    if (transaction.status === 'FAILED') {
      const campayStatus = await campay.getTransactionStatus(reference.trim());
      const normalizedStatus = normalizeCampayStatus(campayStatus.status);
      if (normalizedStatus === 'SUCCESSFUL') {
        const recovered = await processCampayStatus(reference.trim(), normalizedStatus);
        if (recovered?.status === 'SUCCESS') {
          return res.json({
            status: 'SUCCESS',
            ...sessionResponse({
              ...recovered,
              package: recovered.package ?? transaction.package,
              sessionEnd: recovered.sessionEnd,
            }),
          });
        }
      }
      return res.json({ status: 'FAILED', error: 'Payment failed or was declined' });
    }

    const campayStatus = await campay.getTransactionStatus(reference.trim());
    const normalizedStatus = normalizeCampayStatus(campayStatus.status);

    if (normalizedStatus === 'PENDING') {
      return res.json({ status: 'PENDING' });
    }

    const updated = await processCampayStatus(reference.trim(), normalizedStatus);

    if (updated?.status === 'SUCCESS') {
      return res.json({
        status: 'SUCCESS',
        ...sessionResponse({
          ...updated,
          package: updated.package ?? transaction.package,
          sessionEnd: updated.sessionEnd,
        }),
      });
    }

    if (updated?.status === 'FAILED') {
      return res.json({ status: 'FAILED', error: 'Payment failed or was declined' });
    }

    res.json({ status: 'PENDING' });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

export async function getPendingPayment(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, phone } = req.query;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const trimmedDeviceId = deviceId.trim();
    const localPhone = normalizeCameroonMobileLocal(phone);
    await expireStalePendingPayments(prisma, router.id, trimmedDeviceId);

    const pending = await findAnyPendingPayment(prisma, router.id, {
      deviceId: trimmedDeviceId,
      subscriberPhone: localPhone,
    });
    if (!pending?.campayReference) {
      return res.json({ pending: false });
    }

    try {
      const campayStatus = await campay.getTransactionStatus(pending.campayReference);
      const normalizedStatus = normalizeCampayStatus(campayStatus.status);

      if (normalizedStatus === 'SUCCESSFUL') {
        const updated = await processCampayStatus(pending.campayReference, normalizedStatus);
        if (updated?.status === 'SUCCESS') {
          return res.json({
            pending: false,
            session: sessionResponse({
              ...updated,
              package: updated.package ?? pending.package,
              sessionEnd: updated.sessionEnd,
            }),
          });
        }
      }

      if (normalizedStatus === 'FAILED') {
        await processCampayStatus(pending.campayReference, normalizedStatus);
        return res.json({ pending: false });
      }
    } catch {
      // Campay lookup failed — still return pending so the portal can keep polling.
    }

    res.json({
      pending: true,
      reference: pending.campayReference,
      phone: pending.subscriberPhone,
      packageId: pending.packageId,
      packageName: pending.package.name,
      startedAt: pending.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelPendingPayment(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, reference } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const trimmedDeviceId = deviceId.trim();
    await expireStalePendingPayments(prisma, router.id, trimmedDeviceId);

    const pending = await prisma.transaction.findFirst({
      where: {
        routerId: router.id,
        deviceId: trimmedDeviceId,
        status: 'PENDING',
        ...(reference?.trim() ? { campayReference: reference.trim() } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      return res.json({ cancelled: true });
    }

    if (pending.campayReference) {
      try {
        const campayStatus = await campay.getTransactionStatus(pending.campayReference);
        const normalizedStatus = normalizeCampayStatus(campayStatus.status);
        if (normalizedStatus === 'SUCCESSFUL') {
          const recovered = await processCampayStatus(pending.campayReference, normalizedStatus);
          if (recovered?.status === 'SUCCESS') {
            return res.json({
              cancelled: false,
              recovered: true,
              session: sessionResponse({
                ...recovered,
                package: recovered.package,
                sessionEnd: recovered.sessionEnd,
              }),
            });
          }
        }
      } catch {
        // Proceed with local cancel if Campay is unreachable.
      }
    }

    await prisma.transaction.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });

    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
}

export async function disconnectDevice(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, mac, phone } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const normalizedMac = normalizeMac(mac);
    const localPhone = normalizeCameroonMobileLocal(phone);
    const session = await findActiveSession(router.id, {
      deviceId: deviceId.trim(),
      phone: localPhone,
      mac: normalizedMac,
    });

    if (!session) {
      return res.json({ message: 'No active session', active: false });
    }

    await disconnectDeviceOnly(session, normalizedMac);

    res.json({ message: 'Device disconnected', active: false });
  } catch (err) {
    next(err);
  }
}

export async function campayWebhook(req, res, next) {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(200).json({ received: true });
    }

    // Never trust webhook body alone — confirm status with Campay before moving money.
    const campayStatus = await campay.getTransactionStatus(reference.trim());
    await processCampayStatus(reference.trim(), campayStatus.status);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
