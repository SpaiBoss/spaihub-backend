import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { sendAuthenticatorSecurityEmail } from '../services/email.js';
import {
  buildTotp,
  consumeTotpOrBackup,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  isTotpEnabled,
  qrDataUrl,
  totpErrorPayload,
  verifyTotpCode,
} from '../services/totp.js';

function sendAlert(user, event) {
  sendAuthenticatorSecurityEmail(user.email, {
    event,
    locale: user.preferredLocale,
  }).catch(() => {});
}

export function createTotpSecurityHandlers({ model, getUser }) {
  return {
    async getSecurity(req, res, next) {
      try {
        const user = getUser(req);
        res.json({ totpEnabled: isTotpEnabled(user) });
      } catch (err) {
        next(err);
      }
    },

    async start(req, res, next) {
      try {
        const user = getUser(req);
        const { currentPassword } = req.body || {};
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required' });
        }
        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }
        if (isTotpEnabled(user)) {
          return res.status(409).json({ error: 'Authenticator is already enabled' });
        }

        const secret = generateTotpSecret();
        const totp = buildTotp(secret, user.email);
        const otpauthUrl = totp.toString();
        await prisma[model].update({
          where: { id: user.id },
          data: { totpPendingSecretEnc: encryptSecret(secret.base32) },
        });

        res.json({
          otpauthUrl,
          secret: secret.base32,
          qrDataUrl: await qrDataUrl(otpauthUrl),
        });
      } catch (err) {
        const mapped = totpErrorPayload(err);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        next(err);
      }
    },

    async confirm(req, res, next) {
      try {
        const user = getUser(req);
        if (isTotpEnabled(user)) {
          return res.status(409).json({ error: 'Authenticator is already enabled' });
        }
        if (!user.totpPendingSecretEnc) {
          return res.status(400).json({ error: 'Start authenticator setup first' });
        }
        const { code } = req.body || {};
        const pending = decryptSecret(user.totpPendingSecretEnc);
        if (!verifyTotpCode(pending, user.email, code)) {
          return res.status(401).json({ error: 'Invalid authenticator code', code: 'TOTP_INVALID' });
        }

        const backupCodes = generateBackupCodes();
        const backupCodesHash = await hashBackupCodes(backupCodes);
        await prisma[model].update({
          where: { id: user.id },
          data: {
            totpSecretEnc: encryptSecret(pending),
            totpPendingSecretEnc: null,
            totpEnabledAt: new Date(),
            backupCodesHash,
            totpFailCount: 0,
            totpLockedUntil: null,
          },
        });
        sendAlert(user, 'enabled');
        res.json({ backupCodes });
      } catch (err) {
        const mapped = totpErrorPayload(err);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        next(err);
      }
    },

    async disable(req, res, next) {
      try {
        const user = getUser(req);
        const { currentPassword, totpCode, backupCode } = req.body || {};
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required' });
        }
        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }
        await consumeTotpOrBackup(prisma, model, user, { totpCode, backupCode });
        await prisma[model].update({
          where: { id: user.id },
          data: {
            totpSecretEnc: null,
            totpPendingSecretEnc: null,
            totpEnabledAt: null,
            backupCodesHash: [],
            totpFailCount: 0,
            totpLockedUntil: null,
          },
        });
        sendAlert(user, 'disabled');
        res.json({ totpEnabled: false });
      } catch (err) {
        const mapped = totpErrorPayload(err);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        next(err);
      }
    },

    async regenerateBackupCodes(req, res, next) {
      try {
        const user = getUser(req);
        await consumeTotpOrBackup(prisma, model, user, {
          totpCode: req.body?.totpCode,
          backupCode: req.body?.backupCode,
        });
        const backupCodes = generateBackupCodes();
        const backupCodesHash = await hashBackupCodes(backupCodes);
        await prisma[model].update({
          where: { id: user.id },
          data: { backupCodesHash },
        });
        sendAlert(user, 'backup_regenerated');
        res.json({ backupCodes });
      } catch (err) {
        const mapped = totpErrorPayload(err);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        next(err);
      }
    },
  };
}

export { consumeTotpOrBackup, isTotpEnabled, totpErrorPayload };
