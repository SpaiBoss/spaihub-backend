import prisma from '../utils/prisma.js';
import { endHotspotSession } from '../services/sessionLifecycle.js';

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
        router: { select: { id: true, name: true } },
        package: { select: { name: true } },
      },
      orderBy: { sessionEnd: 'asc' },
    });

    res.json(
      sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        subscriberPhone: s.subscriberPhone,
        subscriberMac: s.subscriberMac,
        hotspotUsername: s.hotspotUsername,
        sessionStart: s.sessionStart,
        sessionEnd: s.sessionEnd,
        location: s.location,
        router: s.router,
        packageName: s.package.name,
        paymentSource: s.voucherId ? 'Voucher' : 'Mobile Money',
      }))
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
