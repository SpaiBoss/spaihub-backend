import prisma from '../utils/prisma.js';

export async function grantAccess({
  routerId,
  username,
  password,
  sessionMinutes,
  packageType = 'TIME_BASED',
  dataCapMb,
  uploadSpeedMbPerSec = 1,
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
