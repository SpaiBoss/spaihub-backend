import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import { buildVouchersPdf, PDF_LAYOUTS } from '../services/voucherPdf.js';
import { generateHotspotPin } from '../utils/hotspotCredentials.js';
import { brandingSelectFields, resolvePortalBranding } from '../utils/portalBranding.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateVoucherCode() {
  const segment = () =>
    Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)]).join('');
  return `SPAI-${segment()}-${segment()}`;
}

async function createVoucherRecord({ locationId, packageId, batchLabel, expiresAt }) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateVoucherCode();
    try {
      return await prisma.voucher.create({
        data: {
          locationId,
          packageId,
          code,
          pin: generateHotspotPin(),
          batchLabel: batchLabel?.trim() || null,
          expiresAt,
        },
        include: { package: { select: { name: true, type: true } } },
      });
    } catch (err) {
      if (err.code === 'P2002') continue;
      throw err;
    }
  }
  throw new Error('Failed to generate unique voucher code');
}

async function verifyLocationOwnership(locationId, ownerId) {
  return prisma.location.findFirst({ where: { id: locationId, ownerId } });
}

export async function createVouchers(req, res, next) {
  try {
    const { locationId } = req.params;
    const { packageId, quantity = 1, batchLabel, expiresAt } = req.body;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const qty = Number(quantity);
    if (!packageId) {
      return res.status(400).json({ error: 'Package is required' });
    }
    if (!qty || qty < 1 || qty > 500) {
      return res.status(400).json({ error: 'Quantity must be between 1 and 500' });
    }

    const pkg = await prisma.package.findFirst({
      where: { id: packageId, locationId, isActive: true },
    });
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    let expiryDate = null;
    if (expiresAt) {
      expiryDate = new Date(expiresAt);
      if (Number.isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
        return res.status(400).json({ error: 'Expiry must be a future date' });
      }
    }

    const trimmedBatch = batchLabel?.trim() || null;
    const vouchers = [];
    for (let i = 0; i < qty; i++) {
      const voucher = await createVoucherRecord({
        locationId,
        packageId,
        batchLabel: trimmedBatch,
        expiresAt: expiryDate,
      });
      vouchers.push(voucher);
    }

    res.status(201).json({
      count: vouchers.length,
      batchLabel: trimmedBatch,
      vouchers,
    });
  } catch (err) {
    next(err);
  }
}

export async function getVouchers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const { locationId, status, batchLabel } = req.query;

    const where = {
      location: { ownerId: req.owner.id },
    };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (batchLabel) where.batchLabel = batchLabel;

    const [vouchers, total] = await Promise.all([
      prisma.voucher.findMany({
        where,
        include: {
          location: { select: { name: true } },
          package: { select: { name: true, type: true, durationMinutes: true, dataCapMb: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.voucher.count({ where }),
    ]);

    res.json({
      vouchers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeVoucher(req, res, next) {
  try {
    const { id } = req.params;

    const voucher = await prisma.voucher.findFirst({
      where: { id, location: { ownerId: req.owner.id } },
    });

    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found' });
    }
    if (voucher.status !== 'UNUSED') {
      return res.status(400).json({ error: 'Only unused vouchers can be revoked' });
    }

    const updated = await prisma.voucher.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function exportVouchers(req, res, next) {
  try {
    const { locationId, status, batchLabel } = req.query;

    const where = {
      location: { ownerId: req.owner.id },
    };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (batchLabel) where.batchLabel = batchLabel;

    const vouchers = await prisma.voucher.findMany({
      where,
      include: {
        location: { select: { name: true } },
        package: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = ['Code', 'Location', 'Package', 'Batch', 'Status', 'Expires At', 'Redeemed At', 'Created At'];
    const rows = vouchers.map((v) => [
      v.code,
      v.location.name,
      v.package.name,
      v.batchLabel || '',
      v.status,
      v.expiresAt ? v.expiresAt.toISOString() : '',
      v.redeemedAt ? v.redeemedAt.toISOString() : '',
      v.createdAt.toISOString(),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=vouchers.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function exportVouchersPdf(req, res, next) {
  try {
    const { locationId, status, batchLabel, perPage = '6' } = req.query;
    const perPageNum = Number(perPage);

    if (!PDF_LAYOUTS[perPageNum]) {
      return res.status(400).json({
        error: 'perPage must be one of: 2, 4, 6, 8, 10, 12',
      });
    }

    const where = {
      location: { ownerId: req.owner.id },
    };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (batchLabel) where.batchLabel = batchLabel;

    const vouchers = await prisma.voucher.findMany({
      where,
      include: {
        location: { select: { name: true } },
        package: {
          select: { name: true, type: true, durationMinutes: true, dataCapMb: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const owner = await prisma.owner.findUnique({
      where: { id: req.owner.id },
      select: brandingSelectFields(),
    });
    const branding = resolvePortalBranding(owner);

    const pdf = await buildVouchersPdf(vouchers, perPageNum, branding);
    const brandSlug = branding.brandName
      ? branding.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
      : 'vouchers';
    const filename = `${brandSlug}-${perPageNum}up.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function getVoucherStats(req, res, next) {
  try {
    const ownerId = req.owner.id;
    const [unused, redeemed, expired, revoked] = await Promise.all([
      prisma.voucher.count({ where: { location: { ownerId }, status: 'UNUSED' } }),
      prisma.voucher.count({ where: { location: { ownerId }, status: 'REDEEMED' } }),
      prisma.voucher.count({ where: { location: { ownerId }, status: 'EXPIRED' } }),
      prisma.voucher.count({ where: { location: { ownerId }, status: 'REVOKED' } }),
    ]);

    res.json({ unused, redeemed, expired, revoked, total: unused + redeemed + expired + revoked });
  } catch (err) {
    next(err);
  }
}
