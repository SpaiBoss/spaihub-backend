import prisma from '../utils/prisma.js';
import {
  detectCameroonOperator,
  normalizeCameroonMobileLocal,
  paymentMethodForOperator,
} from '../utils/phone.js';
import { readIdempotencyKey } from '../utils/idempotency.js';
import { isAutoDisburseEnabled } from '../services/withdrawalDisbursement.js';
import {
  settleContributorWithdrawalRequest,
  completeContributorWithdrawalDisbursement,
  holdContributorWithdrawalForAdminRetry,
} from '../services/contributorWithdrawal.js';

const MIN_WITHDRAWAL = 100;
const BYTES_PER_GB = 1024 ** 3;

function serializeLink(link) {
  return {
    id: link.id,
    interfaceName: link.interfaceName,
    capMbps: link.capMbps,
    rateXafPerGb: link.rateXafPerGb,
    status: link.status,
    location: link.location
      ? { id: link.location.id, name: link.location.name }
      : null,
    router: link.router
      ? { id: link.router.id, name: link.router.name }
      : null,
    createdAt: link.createdAt,
  };
}

export async function getContributorMe(req, res, next) {
  try {
    const c = req.contributor;
    res.json({
      id: c.id,
      name: c.name,
      email: c.email,
      status: c.status,
      emailVerified: c.emailVerified,
      momoPhone: c.momoPhone,
      walletBalance: Number(c.walletBalance),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateContributorMe(req, res, next) {
  try {
    const { name, momoPhone } = req.body;
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (momoPhone !== undefined) {
      if (!momoPhone) {
        data.momoPhone = null;
      } else {
        const local = normalizeCameroonMobileLocal(momoPhone);
        if (!local) {
          return res.status(400).json({ error: 'Enter a valid Cameroon mobile number' });
        }
        data.momoPhone = local;
      }
    }

    const updated = await prisma.contributor.update({
      where: { id: req.contributor.id },
      data,
    });

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      momoPhone: updated.momoPhone,
      walletBalance: Number(updated.walletBalance),
    });
  } catch (err) {
    next(err);
  }
}

export async function getContributorDashboard(req, res, next) {
  try {
    const contributorId = req.contributor.id;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const [contributor, links, dayAgg, monthAgg, openAgg] = await Promise.all([
      prisma.contributor.findUnique({
        where: { id: contributorId },
        select: { walletBalance: true, name: true },
      }),
      prisma.contributorLink.findMany({
        where: { contributorId },
        include: {
          location: { select: { id: true, name: true } },
          router: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contributorAccrual.aggregate({
        where: {
          link: { contributorId },
          status: { in: ['OPEN', 'PAID'] },
          createdAt: { gte: startOfDay },
        },
        _sum: { bytes: true, amountXaf: true },
      }),
      prisma.contributorAccrual.aggregate({
        where: {
          link: { contributorId },
          status: { in: ['OPEN', 'PAID'] },
          createdAt: { gte: startOfMonth },
        },
        _sum: { bytes: true, amountXaf: true },
      }),
      prisma.contributorAccrual.aggregate({
        where: { link: { contributorId }, status: 'OPEN' },
        _sum: { amountXaf: true },
      }),
    ]);

    const dayBytes = Number(dayAgg._sum.bytes ?? 0);
    const monthBytes = Number(monthAgg._sum.bytes ?? 0);

    res.json({
      name: contributor.name,
      walletBalance: Number(contributor.walletBalance),
      openEarningsXaf: Number(openAgg._sum.amountXaf || 0),
      today: {
        bytes: dayBytes,
        gb: dayBytes / BYTES_PER_GB,
        amountXaf: Number(dayAgg._sum.amountXaf || 0),
      },
      month: {
        bytes: monthBytes,
        gb: monthBytes / BYTES_PER_GB,
        amountXaf: Number(monthAgg._sum.amountXaf || 0),
      },
      links: links.map(serializeLink),
      activeLinkCount: links.filter((l) => l.status === 'ACTIVE').length,
    });
  } catch (err) {
    next(err);
  }
}

export async function getContributorLinks(req, res, next) {
  try {
    const links = await prisma.contributorLink.findMany({
      where: { contributorId: req.contributor.id },
      include: {
        location: { select: { id: true, name: true } },
        router: { select: { id: true, name: true } },
        meters: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      links: links.map((link) => ({
        ...serializeLink(link),
        lastMeterBytes: link.meters[0] ? link.meters[0].bytesTotal.toString() : null,
        lastMeterAt: link.meters[0]?.recordedAt || null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getContributorWallet(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [contributor, withdrawals, total] = await Promise.all([
      prisma.contributor.findUnique({
        where: { id: req.contributor.id },
        select: { walletBalance: true },
      }),
      prisma.contributorWithdrawal.findMany({
        where: { contributorId: req.contributor.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contributorWithdrawal.count({ where: { contributorId: req.contributor.id } }),
    ]);

    res.json({
      walletBalance: Number(contributor.walletBalance),
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function requestContributorWithdrawal(req, res, next) {
  try {
    const { amountXaf, phoneNumber, method: requestedMethod } = req.body;
    const idempotencyKey = readIdempotencyKey(req);

    if (!amountXaf || amountXaf < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} XAF` });
    }

    const localPhone = normalizeCameroonMobileLocal(phoneNumber);
    if (!localPhone) {
      return res.status(400).json({ error: 'Enter a valid Cameroon mobile number (e.g. 677123456)' });
    }

    const operator = detectCameroonOperator(localPhone);
    const method = paymentMethodForOperator(operator);
    if (!method) {
      return res.status(400).json({
        error: 'Use a valid MTN MoMo (67/68/650-654) or Orange Money (69/655-659) number.',
      });
    }
    if (requestedMethod && requestedMethod !== method) {
      const network = operator === 'MTN' ? 'MTN MoMo' : 'Orange Money';
      return res.status(400).json({ error: `This number is ${network}. Use the matching Mobile Money network.` });
    }

    if (idempotencyKey) {
      const existing = await prisma.contributorWithdrawal.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (existing.contributorId !== req.contributor.id) {
          return res.status(409).json({ error: 'Duplicate request.' });
        }
        const statusCode = existing.status === 'PENDING' ? 202 : 201;
        return res.status(statusCode).json(existing);
      }
    }

    let withdrawal;
    try {
      withdrawal = await prisma.$transaction(async (tx) =>
        settleContributorWithdrawalRequest(tx, {
          contributorId: req.contributor.id,
          amountXaf,
          phoneNumber: localPhone,
          method,
          idempotencyKey,
        })
      );
    } catch (err) {
      if (err.code === 'P2002' && idempotencyKey) {
        const existing = await prisma.contributorWithdrawal.findUnique({ where: { idempotencyKey } });
        if (existing && existing.contributorId === req.contributor.id) {
          const statusCode = existing.status === 'PENDING' ? 202 : 201;
          return res.status(statusCode).json(existing);
        }
      }
      throw err;
    }

    if (!isAutoDisburseEnabled()) {
      return res.status(201).json(withdrawal);
    }

    try {
      const completed = await completeContributorWithdrawalDisbursement(withdrawal.id);
      return res.status(201).json(completed);
    } catch (err) {
      const message = err.message || 'Mobile Money transfer failed';
      const clearCampayReference = err.statusCode === 400 || err.statusCode === 502;
      await holdContributorWithdrawalForAdminRetry(withdrawal.id, message, { clearCampayReference });
      return res.status(202).json({
        status: 'PENDING',
        pendingAdminRetry: true,
        message: 'Withdrawal is queued. An admin will complete the MoMo transfer shortly.',
        error: message,
        withdrawal: {
          id: withdrawal.id,
          amountXaf: withdrawal.amountXaf,
          status: withdrawal.status,
        },
      });
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}
