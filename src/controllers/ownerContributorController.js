import prisma from '../utils/prisma.js';
import { getOwnerContributorReservedXaf } from '../services/contributorReserve.js';

export async function getOwnerContributorLinks(req, res, next) {
  try {
    const [links, reserved] = await Promise.all([
      prisma.contributorLink.findMany({
        where: {
          location: { ownerId: req.owner.id },
        },
        include: {
          contributor: { select: { id: true, name: true, email: true } },
          location: { select: { id: true, name: true } },
          router: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      getOwnerContributorReservedXaf(req.owner.id),
    ]);

    res.json({
      contributorReservedXaf: reserved,
      links: links.map((l) => ({
        id: l.id,
        interfaceName: l.interfaceName,
        capMbps: l.capMbps,
        rateXafPerGb: l.rateXafPerGb,
        status: l.status,
        contributor: l.contributor,
        location: l.location,
        router: l.router,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}
