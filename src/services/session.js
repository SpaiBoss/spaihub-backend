import * as mikrotik from './mikrotik.js';
import { generateHotspotPin, normalizeHotspotUsername } from '../utils/hotspotCredentials.js';
import { effectiveAccessDeviceLimit } from './accessPolicy.js';

export async function completePaidSession(tx, { transaction, pkg, routerId, location }) {
  const now = new Date();
  const sessionEnd = new Date(now.getTime() + pkg.durationMinutes * 60 * 1000);
  const hotspotUsername = normalizeHotspotUsername(transaction.subscriberPhone);
  const hotspotPin = generateHotspotPin();

  if (!hotspotUsername) {
    throw Object.assign(new Error('Invalid subscriber phone for hotspot login'), { statusCode: 400 });
  }

  await tx.transaction.update({
    where: { id: transaction.id },
    data: {
      status: 'SUCCESS',
      sessionStart: now,
      sessionEnd,
      hotspotUsername,
      hotspotPin,
    },
  });

  await tx.owner.update({
    where: { id: transaction.ownerId },
    data: { walletBalance: { increment: transaction.ownerCreditXaf } },
  });

  const sharedUsers = effectiveAccessDeviceLimit(location?.maxDevicesPerAccessCode);

  await mikrotik.grantAccess({
    routerId,
    username: hotspotUsername,
    password: hotspotPin,
    sessionMinutes: pkg.durationMinutes,
    dataCapMb: pkg.dataCapMb,
    uploadSpeedMbPerSec: pkg.uploadSpeedMbPerSec ?? 1,
    sharedUsers,
  });

  return { sessionStart: now, sessionEnd, hotspotUsername, hotspotPin };
}
