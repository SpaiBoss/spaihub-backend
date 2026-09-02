import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import {
  buildRouterSetup,
  buildCommandsRouterOs,
  buildPreviewPortalUrl,
} from '../services/mikrotikScripts.js';
import { parseChrConfig, parseDeploymentType } from '../utils/chrConfig.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

async function verifyLocationOwnership(locationId, ownerId) {
  return prisma.location.findFirst({ where: { id: locationId, ownerId } });
}

async function verifyRouter(locationId, routerId, ownerId) {
  const location = await verifyLocationOwnership(locationId, ownerId);
  if (!location) return { error: 'Location not found', status: 404 };

  const router = await prisma.router.findFirst({
    where: { id: routerId, locationId, isActive: true },
  });
  if (!router) return { error: 'Router not found', status: 404 };

  return { location, router };
}

function isRouterOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

function chrConfigFromQuery(query) {
  if (query.chrConfig) {
    try {
      const parsed = typeof query.chrConfig === 'string'
        ? JSON.parse(query.chrConfig)
        : query.chrConfig;
      return parseChrConfig(parsed);
    } catch {
      return { error: 'Invalid chrConfig JSON in query' };
    }
  }

  const hasFields = ['wanInterface', 'lanInterface', 'bridgeName', 'hotspotName', 'localNetwork', 'gatewayIp', 'dhcpPool']
    .some((key) => query[key] !== undefined);

  if (hasFields) {
    return parseChrConfig({
      wanInterface: query.wanInterface,
      lanInterface: query.lanInterface,
      bridgeName: query.bridgeName,
      hotspotName: query.hotspotName,
      localNetwork: query.localNetwork,
      gatewayIp: query.gatewayIp,
      dhcpPool: query.dhcpPool,
    });
  }

  return null;
}

function resolveSetupOptions(router, req) {
  const override = chrConfigFromQuery(req.query);
  if (override?.error) return { error: override.error };

  const chrConfig = override?.data ?? router.chrConfig ?? null;
  return {
    deploymentType: router.deploymentType,
    chrConfig,
  };
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
    const { name, deploymentType: deploymentTypeRaw, chrConfig: chrConfigRaw } = req.body;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Router name is required' });
    }

    const deployment = parseDeploymentType(deploymentTypeRaw);
    if (deployment.error) {
      return res.status(400).json({ error: deployment.error });
    }

    let chrConfig = null;
    if (deployment.data === 'CHR') {
      const parsed = parseChrConfig(chrConfigRaw);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      chrConfig = parsed.data;
    }

    const routerToken = uuidv4();

    const router = await prisma.router.create({
      data: {
        locationId,
        name: name.trim(),
        routerToken,
        deploymentType: deployment.data,
        chrConfig,
      },
    });

    res.status(201).json({
      ...withPortalMeta(router),
      ...buildRouterSetup(routerToken, location, {
        deploymentType: router.deploymentType,
        chrConfig: router.chrConfig,
      }),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateRouter(req, res, next) {
  try {
    const { locationId, routerId } = req.params;
    const { name, chrConfig: chrConfigRaw } = req.body;

    const verified = await verifyRouter(locationId, routerId, req.owner.id);
    if (verified.error) {
      return res.status(verified.status).json({ error: verified.error });
    }

    const data = {};
    if (name !== undefined) {
      if (!name?.trim()) {
        return res.status(400).json({ error: 'Router name is required' });
      }
      data.name = name.trim();
    }

    if (chrConfigRaw !== undefined) {
      const parsed = parseChrConfig(chrConfigRaw);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      data.chrConfig = parsed.data;
    }

    const router = await prisma.router.update({
      where: { id: routerId },
      data,
    });

    res.json({
      ...withPortalMeta(router),
      ...buildRouterSetup(router.routerToken, verified.location, {
        deploymentType: router.deploymentType,
        chrConfig: router.chrConfig,
      }),
    });
  } catch (err) {
    next(err);
  }
}

export async function getRouterSetupScript(req, res, next) {
  try {
    const { locationId, routerId } = req.params;

    const verified = await verifyRouter(locationId, routerId, req.owner.id);
    if (verified.error) {
      return res.status(verified.status).json({ error: verified.error });
    }

    const options = resolveSetupOptions(verified.router, req);
    if (options.error) {
      return res.status(400).json({ error: options.error });
    }

    res.json({
      router: withPortalMeta(verified.router),
      ...buildRouterSetup(verified.router.routerToken, verified.location, options),
    });
  } catch (err) {
    next(err);
  }
}

export async function getRouterOnboardingStatus(req, res, next) {
  try {
    const { locationId, routerId } = req.params;

    const verified = await verifyRouter(locationId, routerId, req.owner.id);
    if (verified.error) {
      return res.status(verified.status).json({ error: verified.error });
    }

    let router = verified.router;
    const online = isRouterOnline(router.lastSeenAt);

    if (online && !router.onboardingCompletedAt) {
      router = await prisma.router.update({
        where: { id: router.id },
        data: { onboardingCompletedAt: new Date() },
      });
    }

    res.json({
      status: router.status,
      lastSeenAt: router.lastSeenAt,
      isOnline: online,
      onboardingCompletedAt: router.onboardingCompletedAt,
      deploymentType: router.deploymentType,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteRouter(req, res, next) {
  try {
    const { locationId, routerId } = req.params;

    const verified = await verifyRouter(locationId, routerId, req.owner.id);
    if (verified.error) {
      return res.status(verified.status).json({ error: verified.error });
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
    const { fetchPendingCommands } = await import('../services/routerCommandService.js');
    const commands = await fetchPendingCommands(req.router.id);
    const script = buildCommandsRouterOs(commands);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  } catch (err) {
    next(err);
  }
}

export async function ackRouterCommands(req, res, next) {
  try {
    const { acknowledgeCommands } = await import('../services/routerCommandService.js');
    const { success = true, error, commandIds } = req.body ?? {};
    const count = await acknowledgeCommands(req.router.id, {
      success: Boolean(success),
      error,
      commandIds: Array.isArray(commandIds) ? commandIds : undefined,
    });
    res.json({ acknowledged: count });
  } catch (err) {
    next(err);
  }
}
