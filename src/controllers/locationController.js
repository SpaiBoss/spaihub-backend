import prisma from '../utils/prisma.js';
import { parseAccessPolicyInput } from '../services/accessPolicy.js';

async function getActiveSessionCount(locationId) {
  const now = new Date();
  return prisma.transaction.count({
    where: {
      locationId,
      status: 'SUCCESS',
      sessionEnd: { gt: now },
    },
  });
}

export async function getLocations(req, res, next) {
  try {
    const locations = await prisma.location.findMany({
      where: { ownerId: req.owner.id },
      include: {
        _count: { select: { routers: true } },
        routers: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = await Promise.all(
      locations.map(async (loc) => {
        const onlineRouters = loc.routers.filter((r) => r.status === 'ONLINE').length;
        const activeSessions = await getActiveSessionCount(loc.id);
        const { routers, ...rest } = loc;
        return {
          ...rest,
          routerCount: loc._count.routers,
          onlineRouters,
          activeSessions,
        };
      })
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createLocation(req, res, next) {
  try {
    const { name, address } = req.body;
    if (!name?.trim() || !address?.trim()) {
      return res.status(400).json({ error: 'Name and address are required' });
    }

    const location = await prisma.location.create({
      data: {
        ownerId: req.owner.id,
        name: name.trim(),
        address: address.trim(),
      },
    });

    res.status(201).json(location);
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(req, res, next) {
  try {
    const { id } = req.params;
    const { name, address, isActive } = req.body;

    const location = await prisma.location.findFirst({
      where: { id, ownerId: req.owner.id },
    });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const policy = parseAccessPolicyInput(req.body);
    if (policy.error) {
      return res.status(400).json({ error: policy.error });
    }

    const updated = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(address !== undefined && { address: address.trim() }),
        ...(isActive !== undefined && { isActive }),
        ...policy.data,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
