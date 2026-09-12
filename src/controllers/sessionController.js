import prisma from '../utils/prisma.js';
import { endHotspotSession } from '../services/sessionLifecycle.js';

function parseHotspotActiveBody(body) {
  let raw = '';
  if (typeof body === 'string') {
    raw = body;
  } else if (Buffer.isBuffer(body)) {
    raw = body.toString('utf8');
  } else if (body && typeof body === 'object') {
    // Fallback if a proxy turned the body into key/value pairs
    raw = Object.keys(body).join(';');
  }

  const entries = [];
  for (const part of String(raw).split(/[;\n\r]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const comma = trimmed.indexOf(',');
    if (comma <= 0) continue;
    const username = trimmed.slice(0, comma).trim();
    const mac = trimmed.slice(comma + 1).trim();
    if (!username) continue;
    entries.push({ username, mac: mac || null });
  }
  return entries;
}

export async function reportHotspotActive(req, res, next) {
  try {
    const entries = parseHotspotActiveBody(req.body);
    await prisma.router.update({
      where: { id: req.router.id },
      data: {
        hotspotActiveSnapshot: entries,
        hotspotActiveAt: new Date(),
        lastSeenAt: new Date(),
        status: 'ONLINE',
      },
    });
    res.json({ status: 'ok', count: entries.length });
  } catch (err) {
    next(err);
  }
}

export async function getActiveSessions(req, res, next) {
  try {
    const now = new Date();

    const sessions = await prisma.transaction.findMany({
      where: {
        ownerId: req.owner.id,
        status: 'SUCCESS',
        sessionEnd: { gt: now },
      },
      include: {
        location: { select: { id: true, name: true } },
        router: {
          select: {
            id: true,
            name: true,
            hotspotActiveSnapshot: true,
            hotspotActiveAt: true,
          },
        },
        package: { select: { name: true } },
      },
      orderBy: { sessionEnd: 'asc' },
    });

    res.json(
      sessions.map((s) => {
        const snapshot = Array.isArray(s.router?.hotspotActiveSnapshot)
          ? s.router.hotspotActiveSnapshot
          : [];
        const username = s.hotspotUsername;
        const match = username
          ? snapshot.find((row) => row && row.username === username)
          : null;
        const snapshotAt = s.router?.hotspotActiveAt
          ? new Date(s.router.hotspotActiveAt).getTime()
          : null;
        const snapshotAgeSec =
          snapshotAt != null ? Math.max(0, Math.round((Date.now() - snapshotAt) / 1000)) : null;

        return {
          id: s.id,
          deviceId: s.deviceId,
          subscriberPhone: s.subscriberPhone,
          subscriberMac: s.subscriberMac,
          hotspotUsername: s.hotspotUsername,
          sessionStart: s.sessionStart,
          sessionEnd: s.sessionEnd,
          location: s.location,
          router: { id: s.router.id, name: s.router.name },
          packageName: s.package.name,
          paymentSource: s.voucherId ? 'Voucher' : 'Mobile Money',
          routerSeen: Boolean(match),
          routerMac: match?.mac || null,
          snapshotAgeSec,
        };
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function kickSession(req, res, next) {
  try {
    const { transactionId } = req.params;
    const now = new Date();

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        ownerId: req.owner.id,
        status: 'SUCCESS',
        sessionEnd: { gt: now },
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    await endHotspotSession(transaction);

    res.json({ message: 'Session ended' });
  } catch (err) {
    next(err);
  }
}
