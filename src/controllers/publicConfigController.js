import { getContactWhatsApp, getPlatformFeePercent } from '../utils/platformConfig.js';

export async function getPublicConfig(_req, res) {
  res.json({
    platformFeePercent: getPlatformFeePercent(),
    contactWhatsApp: getContactWhatsApp(),
  });
}
