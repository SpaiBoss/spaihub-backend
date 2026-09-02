import * as mikrotik from './mikrotik.js';
import { generateHotspotPin, normalizeHotspotUsername } from '../utils/hotspotCredentials.js';
import { resolvePackageAccessLimits } from '../utils/packageAccess.js';

export async function completePaidSession(tx, { transaction, pkg, routerId, location }) {
  const now = new Date();
  const sessionEnd = new Date(now.getTime() + pkg.durationMinutes * 60 * 1000);
  const hotspotUsername = normalizeHotspotUsername(transaction.subscriberPhone);
  const hotspotPin = generateHotspotPin();

  if (!hotspotUsername) {
    throw Object.assign(new Error('Invalid subscriber phone for hotspot login'), { statusCode: 400 });
  }

  const claimed = await tx.transaction.updateMany({
    where: { id: transaction.id, status: 'PENDING' },
    data: {
      status: 'SUCCESS',
      sessionStart: now,
      sessionEnd,
      hotspotUsername,
      hotspotPin,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  await tx.owner.update({
    where: { id: transaction.ownerId },
    data: { walletBalance: { increment: transaction.ownerCreditXaf } },
  });

  const access = resolvePackageAccessLimits(pkg);

  await mikrotik.grantAccess({
    routerId,
    username: hotspotUsername,
    password: hotspotPin,
    sessionMinutes: access.sessionMinutes,
    packageType: access.packageType,
    dataCapMb: access.applyByteLimit ? access.dataCapMb : null,
    uploadSpeedMbPerSec: access.uploadSpeedMbPerSec,
    downloadSpeedMbPerSec: access.downloadSpeedMbPerSec,
    sharedUsers: access.sharedUsers,
  });

  return { sessionStart: now, sessionEnd, hotspotUsername, hotspotPin };
}
