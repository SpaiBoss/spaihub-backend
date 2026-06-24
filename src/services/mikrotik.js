import prisma from '../utils/prisma.js';

export async function grantAccess({
  routerId,
  username,
  password,
  sessionMinutes,
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
        dataCapMb: dataCapMb ?? null,
        uploadSpeedMbPerSec,
        sharedUsers,
      },
    },
  });
}

export async function kickUser({ routerId, username }) {
  await prisma.routerCommand.create({
    data: {
      routerId,
      type: 'KICK_USER',
      payload: { username },
    },
  });
}
