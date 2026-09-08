import prisma from '../utils/prisma.js';

export async function grantAccess({
  routerId,
  username,
  password,
  sessionMinutes,
  packageType = 'TIME_BASED',
  dataCapMb,
  uploadSpeedMbPerSec = 1,
  downloadSpeedMbPerSec = null,
  sharedUsers = 1,
}) {
  await prisma.routerCommand.create({
    data: {
      routerId,
      type: 'GRANT_ACCESS',
      payload: {
        username,
        password,
        sessionMinutes,
        packageType,
        dataCapMb: dataCapMb ?? null,
        uploadSpeedMbPerSec,
        downloadSpeedMbPerSec,
        sharedUsers,
      },
    },
  });
}

export async function kickUser({ routerId, username, macAddress = null }) {
  await prisma.routerCommand.create({
    data: {
      routerId,
      type: 'KICK_USER',
      payload: {
        username,
        macAddress: macAddress ?? null,
      },
    },
  });
}

export async function queueAccessPolicyUpdate(locationId, location) {
  const routers = await prisma.router.findMany({
    where: { locationId, isActive: true },
    select: { id: true },
  });

  // Always queue remove-only anti-tether cleanup (TTL rules are never re-installed).
  await Promise.all(
    routers.map((router) =>
      prisma.routerCommand.create({
        data: {
          routerId: router.id,
          type: 'UPDATE_ACCESS_POLICY',
          payload: { enableAntiTethering: false },
        },
      })
    )
  );
}
