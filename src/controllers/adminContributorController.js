import prisma from '../utils/prisma.js';
import { ingestMeterSample } from '../services/contributorAccrual.js';
import {
  completeContributorWithdrawalDisbursement,
  failContributorWithdrawalAndRefund,
  markContributorWithdrawalApproved,
} from '../services/contributorWithdrawal.js';

export async function listLocationsForAdmin(req, res, next) {
  try {
    const locations = await prisma.location.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { name: true, email: true } },
        routers: { select: { id: true, name: true } },
      },
    });
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}

export async function listAdminLocations(req, res, next) {
  try {
    const locations = await prisma.location.findMany({
      orderBy: { name: 'asc' },
      take: 200,
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { name: true, email: true } },
        routers: { select: { id: true, name: true } },
      },
    });
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}

export async function listContributors(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const where = status ? { status } : {};

    const [contributors, total] = await Promise.all([
      prisma.contributor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { links: true } },
        },
      }),
      prisma.contributor.count({ where }),
    ]);

    res.json({
      contributors: contributors.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        status: c.status,
        emailVerified: c.emailVerified,
        walletBalance: Number(c.walletBalance),
        linkCount: c._count.links,
        createdAt: c.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function activateContributor(req, res, next) {
  try {
    const { id } = req.params;
    const contributor = await prisma.contributor.findUnique({ where: { id } });
    if (!contributor) {
      return res.status(404).json({ error: 'Contributor not found' });
    }
    if (contributor.status === 'ACTIVE') {
      return res.json(contributor);
    }

    const updated = await prisma.contributor.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifyToken: null,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function updateContributorStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE or SUSPENDED' });
    }
    const contributor = await prisma.contributor.findUnique({ where: { id } });
    if (!contributor) {
      return res.status(404).json({ error: 'Contributor not found' });
    }
    const updated = await prisma.contributor.update({
      where: { id },
      data: { status },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function listContributorLinks(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const where = {};
    if (req.query.contributorId) where.contributorId = req.query.contributorId;
    if (req.query.locationId) where.locationId = req.query.locationId;
    if (req.query.status) where.status = req.query.status;

    const [links, total] = await Promise.all([
      prisma.contributorLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          contributor: { select: { id: true, name: true, email: true } },
          location: { select: { id: true, name: true, ownerId: true } },
          router: { select: { id: true, name: true } },
        },
      }),
      prisma.contributorLink.count({ where }),
    ]);

    res.json({
      links,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function createContributorLink(req, res, next) {
  try {
    const {
      contributorId,
      locationId,
      routerId,
      interfaceName,
      capMbps,
      rateXafPerGb,
      status = 'PENDING',
      notes,
    } = req.body;

    if (!contributorId || !locationId || !interfaceName?.trim() || !capMbps || !rateXafPerGb) {
      return res.status(400).json({
        error: 'contributorId, locationId, interfaceName, capMbps, and rateXafPerGb are required',
      });
    }

    const [contributor, location] = await Promise.all([
      prisma.contributor.findUnique({ where: { id: contributorId } }),
      prisma.location.findUnique({
        where: { id: locationId },
        include: { routers: { select: { id: true } } },
      }),
    ]);
    if (!contributor) return res.status(404).json({ error: 'Contributor not found' });
    if (!location) return res.status(404).json({ error: 'Location not found' });

    let resolvedRouterId = routerId || null;
    if (resolvedRouterId) {
      const router = await prisma.router.findFirst({
        where: { id: resolvedRouterId, locationId },
      });
      if (!router) {
        return res.status(400).json({ error: 'Router not found at this location' });
      }
    }

    if (!['PENDING', 'ACTIVE', 'PAUSED', 'DISABLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid link status' });
    }

    const link = await prisma.contributorLink.create({
      data: {
        contributorId,
        locationId,
        routerId: resolvedRouterId,
        interfaceName: String(interfaceName).trim(),
        capMbps: Number(capMbps),
        rateXafPerGb: Number(rateXafPerGb),
        status,
        notes: notes?.trim() || null,
      },
      include: {
        contributor: { select: { id: true, name: true, email: true } },
        location: { select: { id: true, name: true } },
        router: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

export async function updateContributorLink(req, res, next) {
  try {
    const { id } = req.params;
    const link = await prisma.contributorLink.findUnique({ where: { id } });
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const data = {};
    const { interfaceName, capMbps, rateXafPerGb, status, notes, routerId } = req.body;

    if (interfaceName !== undefined) data.interfaceName = String(interfaceName).trim();
    if (capMbps !== undefined) data.capMbps = Number(capMbps);
    if (rateXafPerGb !== undefined) data.rateXafPerGb = Number(rateXafPerGb);
    if (status !== undefined) {
      if (!['PENDING', 'ACTIVE', 'PAUSED', 'DISABLED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid link status' });
      }
      data.status = status;
    }
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (routerId !== undefined) {
      if (routerId === null || routerId === '') {
        data.routerId = null;
      } else {
        const router = await prisma.router.findFirst({
          where: { id: routerId, locationId: link.locationId },
        });
        if (!router) return res.status(400).json({ error: 'Router not found at this location' });
        data.routerId = routerId;
      }
    }

    const updated = await prisma.contributorLink.update({
      where: { id },
      data,
      include: {
        contributor: { select: { id: true, name: true, email: true } },
        location: { select: { id: true, name: true } },
        router: { select: { id: true, name: true } },
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function getContributorLink(req, res, next) {
  try {
    const link = await prisma.contributorLink.findUnique({
      where: { id: req.params.id },
      include: {
        contributor: { select: { id: true, name: true, email: true, status: true } },
        location: { select: { id: true, name: true, ownerId: true } },
        router: { select: { id: true, name: true } },
        meters: { orderBy: { recordedAt: 'desc' }, take: 20 },
        accruals: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!link) return res.status(404).json({ error: 'Link not found' });

    res.json({
      ...link,
      meters: link.meters.map((m) => ({
        ...m,
        bytesTotal: m.bytesTotal.toString(),
      })),
      accruals: link.accruals.map((a) => ({
        ...a,
        bytes: a.bytes.toString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function postContributorLinkMeter(req, res, next) {
  try {
    const { id } = req.params;
    const { bytesTotal, bytesDelta } = req.body;

    let total;
    if (bytesTotal !== undefined && bytesTotal !== null && bytesTotal !== '') {
      total = BigInt(bytesTotal);
    } else if (bytesDelta !== undefined && bytesDelta !== null && bytesDelta !== '') {
      const prev = await prisma.contributorMeterSample.findFirst({
        where: { linkId: id },
        orderBy: { recordedAt: 'desc' },
      });
      const prevTotal = prev ? prev.bytesTotal : 0n;
      total = prevTotal + BigInt(bytesDelta);
    } else {
      return res.status(400).json({ error: 'Provide bytesTotal or bytesDelta' });
    }

    const result = await ingestMeterSample(id, { bytesTotal: total, source: 'ADMIN' });
    res.status(201).json({
      sample: {
        ...result.sample,
        bytesTotal: result.sample.bytesTotal.toString(),
      },
      accrual: result.accrual
        ? { ...result.accrual, bytes: result.accrual.bytes.toString() }
        : null,
      skipped: result.skipped,
      reason: result.reason,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

export async function listContributorWithdrawals(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const [withdrawals, total] = await Promise.all([
      prisma.contributorWithdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          contributor: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.contributorWithdrawal.count({ where }),
    ]);

    res.json({
      withdrawals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function processContributorWithdrawal(req, res, next) {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;

    if (!['APPROVE', 'REJECT', 'RETRY_DISBURSE'].includes(action)) {
      return res.status(400).json({ error: 'action must be APPROVE, REJECT, or RETRY_DISBURSE' });
    }

    const withdrawal = await prisma.contributorWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    if (action === 'REJECT') {
      const updated = await failContributorWithdrawalAndRefund(id, adminNote);
      return res.json(updated);
    }

    if (action === 'APPROVE') {
      if (withdrawal.status !== 'PENDING') {
        return res.status(409).json({ error: 'Withdrawal is not pending' });
      }
      const updated = await markContributorWithdrawalApproved(id, adminNote);
      return res.json(updated);
    }

    // RETRY_DISBURSE
    const completed = await completeContributorWithdrawalDisbursement(id);
    res.json(completed);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}
