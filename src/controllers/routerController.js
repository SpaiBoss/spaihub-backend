import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import {
  buildRouterSetup,
  buildCommandsRouterOs,
  buildPreviewPortalUrl,
} from '../services/mikrotikScripts.js';

async function verifyLocationOwnership(locationId, ownerId) {
  return prisma.location.findFirst({ where: { id: locationId, ownerId } });
}

function withPortalMeta(router) {
  return {
    ...router,
    previewPortalUrl: buildPreviewPortalUrl(router.routerToken),
  };
}

export async function getRouters(req, res, next) {
  try {
    const { locationId } = req.params;
    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const routers = await prisma.router.findMany({
      where: { locationId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(routers.map(withPortalMeta));
  } catch (err) {
    next(err);
  }
}

export async function addRouter(req, res, next) {
  try {
    const { locationId } = req.params;
    const { name } = req.body;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Router name is required' });
    }

    const routerToken = uuidv4();

    const router = await prisma.router.create({
      data: {
        locationId,
        name: name.trim(),
        routerToken,
      },
    });

    res.status(201).json({
      ...withPortalMeta(router),
      ...buildRouterSetup(routerToken, location),
    });
  } catch (err) {
    next(err);
  }
}

export async function getRouterSetupScript(req, res, next) {
  try {
    const { locationId, routerId } = req.params;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const router = await prisma.router.findFirst({
      where: { id: routerId, locationId, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    res.json({
      router: withPortalMeta(router),
      ...buildRouterSetup(router.routerToken, location),
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteRouter(req, res, next) {
  try {
    const { locationId, routerId } = req.params;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const router = await prisma.router.findFirst({
      where: { id: routerId, locationId, isActive: true },
    });

    if (!router) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const now = new Date();
    const activeSessions = await prisma.transaction.count({
      where: {
        routerId,
        status: 'SUCCESS',
        sessionEnd: { gt: now },
      },
    });

    if (activeSessions > 0) {
      return res.status(400).json({ error: 'Cannot delete router with active sessions' });
    }

    await prisma.router.update({
      where: { id: routerId },
      data: { isActive: false, status: 'OFFLINE' },
    });

    res.json({ message: 'Router deactivated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function routerHeartbeat(req, res, next) {
  try {
    await prisma.router.update({
      where: { id: req.router.id },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
}

export async function getRouterCommands(req, res, next) {
  try {
    const commands = await prisma.routerCommand.findMany({
      where: { routerId: req.router.id, executed: false },
      orderBy: { createdAt: 'asc' },
    });

    const script = buildCommandsRouterOs(commands);

    if (commands.length > 0) {
      await prisma.routerCommand.updateMany({
        where: { id: { in: commands.map((c) => c.id) } },
        data: { executed: true },
      });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  } catch (err) {
    next(err);
  }
}
