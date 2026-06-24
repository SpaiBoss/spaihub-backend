import prisma from '../utils/prisma.js';
import * as campay from '../services/campay.js';
import * as mikrotik from '../services/mikrotik.js';
import { completePaidSession } from '../services/session.js';
import { findActiveSession, sessionResponse } from '../services/portalSession.js';
import { isValidDeviceId, normalizeMac } from '../utils/deviceId.js';
import {
  getActiveVoucherSessions,
  validateAccessPolicy,
  effectiveAccessDeviceLimit,
} from '../services/accessPolicy.js';
import { resolvePortalBranding, brandingSelectFields } from '../utils/portalBranding.js';

const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT) || 2;

function normalizeVoucherCode(code) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizePin(pin) {
  return String(pin || '').trim();
}

async function provisionHotspotUser({ routerId, location, pkg, sessionMinutes, username, password }) {
  await mikrotik.grantAccess({
    routerId,
    username,
    password,
    sessionMinutes,
    dataCapMb: pkg.dataCapMb,
    uploadSpeedMbPerSec: pkg.uploadSpeedMbPerSec ?? 1,
    sharedUsers: effectiveAccessDeviceLimit(location.maxDevicesPerAccessCode),
  });
}

export async function getPortal(req, res, next) {
  try {
    const { routerToken } = req.params;

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
      include: {
        location: {
          include: {
            owner: { select: brandingSelectFields() },
            packages: { where: { isActive: true }, orderBy: { priceXaf: 'asc' } },
          },
        },
      },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    res.json({
      locationName: router.location.name,
      routerStatus: router.status,
      packages: router.location.packages,
      branding: resolvePortalBranding(router.location.owner),
    });
  } catch (err) {
    next(err);
  }
}

export async function checkSession(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { deviceId, mac } = req.query;

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
    const session = await findActiveSession(router.id, {
      deviceId: deviceId.trim(),
      mac: normalizedMac,
    });

    if (!session) {
      return res.json({ active: false });
    }

    if (normalizedMac && normalizedMac !== session.subscriberMac) {
      await prisma.transaction.update({
        where: { id: session.id },
        data: { subscriberMac: normalizedMac },
      });
    }

    res.json(sessionResponse(session));
  } catch (err) {
    next(err);
  }
}

export async function initiatePayment(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { packageId, phoneNumber, macAddress, deviceId } = req.body;

    if (!packageId || !phoneNumber || !isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'packageId, phoneNumber, and deviceId are required' });
    }

    const normalizedMac = normalizeMac(macAddress);

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
      include: { location: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const pkg = await prisma.package.findFirst({
      where: { id: packageId, locationId: router.locationId, isActive: true },
    });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const platformFeeXaf = Math.floor(pkg.priceXaf * (FEE_PERCENT / 100));
    const ownerCreditXaf = pkg.priceXaf - platformFeeXaf;

    const transaction = await prisma.transaction.create({
      data: {
        ownerId: router.location.ownerId,
        locationId: router.locationId,
        routerId: router.id,
        packageId: pkg.id,
        subscriberPhone: phoneNumber,
        subscriberMac: normalizedMac,
        deviceId: deviceId.trim(),
        amountXaf: pkg.priceXaf,
        platformFeeXaf,
        ownerCreditXaf,
        status: 'PENDING',
      },
    });

    const redirectBase = `${process.env.FRONTEND_URL}/portal/${routerToken}`;
    const redirectParams = new URLSearchParams();
    if (normalizedMac) redirectParams.set('mac', normalizedMac);
    const redirectUrl = redirectParams.toString()
      ? `${redirectBase}?${redirectParams}`
      : redirectBase;

    const payment = await campay.initiatePayment({
      amount: pkg.priceXaf,
      from: phoneNumber,
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
    });
  } catch (err) {
    next(err);
  }
}

export async function redeemVoucher(req, res, next) {
  try {
    const { routerToken } = req.params;
    const { code, pin, macAddress, deviceId } = req.body;

    if (!code?.trim() || !pin?.trim() || !isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'Voucher code, PIN, and deviceId are required' });
    }

    const normalizedMac = normalizeMac(macAddress);
    const normalizedPin = normalizePin(pin);

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
      include: { location: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const normalizedCode = normalizeVoucherCode(code);
    const voucher = await prisma.voucher.findUnique({
      where: { code: normalizedCode },
      include: { package: true },
    });

    if (!voucher) {
      return res.status(404).json({ error: 'Invalid voucher code' });
    }

    if (!voucher.pin) {
      return res.status(400).json({ error: 'This voucher has no PIN. Contact the location owner for a new voucher.' });
    }

    if (voucher.pin !== normalizedPin) {
      return res.status(400).json({ error: 'Invalid PIN' });
    }

    if (voucher.locationId !== router.locationId) {
      return res.status(400).json({ error: 'This voucher is not valid at this location' });
    }

    if (voucher.status === 'REVOKED') {
      return res.status(400).json({ error: 'This voucher has been revoked' });
    }

    if (voucher.status === 'EXPIRED' || (voucher.expiresAt && voucher.expiresAt < new Date())) {
      if (voucher.status === 'UNUSED') {
        await prisma.voucher.update({ where: { id: voucher.id }, data: { status: 'EXPIRED' } });
      }
      return res.status(400).json({ error: 'This voucher has expired' });
    }

    const trimmedDeviceId = deviceId.trim();
    const activeSessions = await getActiveVoucherSessions(voucher.id);
    const isExistingDevice = activeSessions.some((session) => session.deviceId === trimmedDeviceId);

    if (voucher.status === 'REDEEMED' && activeSessions.length === 0) {
      return res.status(400).json({ error: 'This voucher has already been used' });
    }

    if (voucher.status !== 'UNUSED' && voucher.status !== 'REDEEMED') {
      return res.status(400).json({ error: 'This voucher is not available' });
    }

    const policyCheck = validateAccessPolicy(router.location, {
      activeDeviceCount: activeSessions.length,
      isExistingDevice,
    });

    if (!policyCheck.ok) {
      return res.status(400).json({ error: policyCheck.error });
    }

    const hotspotUsername = voucher.code;
    const hotspotPin = voucher.pin;

    if (isExistingDevice) {
      const existingSession = activeSessions.find((session) => session.deviceId === trimmedDeviceId);
      if (normalizedMac && normalizedMac !== existingSession.subscriberMac) {
        await prisma.transaction.update({
          where: { id: existingSession.id },
          data: { subscriberMac: normalizedMac },
        });
      }

      return res.json({
        message: 'Already connected',
        sessionEnd: existingSession.sessionEnd,
        packageName: voucher.package.name,
        hotspotUsername,
        hotspotPin,
      });
    }

    const now = new Date();
    const sessionEnd = new Date(now.getTime() + voucher.package.durationMinutes * 60 * 1000);

    const locked = await prisma.voucher.findUnique({ where: { id: voucher.id } });
    if (!locked || (locked.status !== 'UNUSED' && locked.status !== 'REDEEMED')) {
      return res.status(409).json({ error: 'Voucher is no longer available' });
    }

    await prisma.transaction.create({
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
      },
    });

    await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: 'REDEEMED',
        redeemedAt: locked.redeemedAt ?? now,
        redeemedMac: normalizedMac ?? locked.redeemedMac,
        routerId: router.id,
      },
    });

    await provisionHotspotUser({
      routerId: router.id,
      location: router.location,
      pkg: voucher.package,
      sessionMinutes: voucher.package.durationMinutes,
      username: hotspotUsername,
      password: hotspotPin,
    });

    res.json({
      message: 'Voucher redeemed successfully',
      sessionEnd,
      packageName: voucher.package.name,
      hotspotUsername,
      hotspotPin,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

async function processCampayStatus(reference, status) {
  const transaction = await prisma.transaction.findFirst({
    where: { campayReference: reference },
    include: { package: true, location: true },
  });

  if (!transaction || transaction.status !== 'PENDING') {
    return transaction;
  }

  if (status === 'SUCCESSFUL') {
    await prisma.$transaction(async (tx) => {
      await completePaidSession(tx, {
        transaction,
        pkg: transaction.package,
        routerId: transaction.routerId,
        location: transaction.location,
      });
    });
    return prisma.transaction.findFirst({
      where: { id: transaction.id },
      include: {
        package: { select: { name: true, dataCapMb: true } },
      },
    });
  }

  if (status === 'FAILED') {
    await prisma.transaction.update({
      where: { id: transaction.id },
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
      include: { package: { select: { name: true, dataCapMb: true } } },
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
      return res.json({ status: 'FAILED', error: 'Payment failed or was declined' });
    }

    const campayStatus = await campay.getTransactionStatus(reference.trim());

    if (campayStatus.status === 'PENDING') {
      return res.json({ status: 'PENDING' });
    }

    const updated = await processCampayStatus(reference.trim(), campayStatus.status);

    if (updated?.status === 'SUCCESS') {
      return res.json({
        status: 'SUCCESS',
        ...sessionResponse({
          ...updated,
          package: transaction.package,
          sessionEnd: updated.sessionEnd,
        }),
      });
    }

    if (updated?.status === 'FAILED') {
      return res.json({ status: 'FAILED', error: 'Payment failed or was declined' });
    }

    res.json({ status: 'PENDING' });
  } catch (err) {
    next(err);
  }
}

export async function campayWebhook(req, res, next) {
  try {
    const { reference, status } = req.body;

    if (!reference) {
      return res.status(200).json({ received: true });
    }

    await processCampayStatus(reference, status);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
