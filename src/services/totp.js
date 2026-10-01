import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'SpaiHub';
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export function httpError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

export function isTotpEnabled(user) {
  return Boolean(user?.totpEnabledAt);
}

function encryptionKey() {
  const raw = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw httpError('Authenticator is not configured on this server', 503, 'TOTP_UNCONFIGURED');
  }
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw httpError('TOTP_ENCRYPTION_KEY must be 32-byte hex', 503, 'TOTP_UNCONFIGURED');
  }
  return buf;
}

export function encryptSecret(plain) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(packed) {
  const key = encryptionKey();
  const [ivH, tagH, dataH] = String(packed || '').split(':');
  if (!ivH || !tagH || !dataH) {
    throw httpError('Invalid authenticator secret', 500, 'TOTP_CORRUPT');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

export function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 });
}

export function buildTotp(secret, email) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email || 'account',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

export function verifyTotpCode(base32, email, token) {
  const digits = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return false;
  const totp = buildTotp(OTPAuth.Secret.fromBase32(base32), email);
  return totp.validate({ token: digits, window: 1 }) !== null;
}

export async function qrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
}

export function generateBackupCodes(count = 10) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}

export async function hashBackupCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(normalizeBackup(c), 10)));
}

function normalizeBackup(code) {
  return String(code || '').replace(/\s/g, '').toUpperCase();
}

export async function consumeBackupCode(hashes, code) {
  const normalized = normalizeBackup(code);
  if (!normalized || !Array.isArray(hashes)) return { ok: false, remaining: hashes || [] };
  for (let i = 0; i < hashes.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(normalized, hashes[i])) {
      return { ok: true, remaining: hashes.filter((_, j) => j !== i) };
    }
  }
  return { ok: false, remaining: hashes };
}

export function assertTotpUnlocked(user) {
  if (user.totpLockedUntil && new Date(user.totpLockedUntil) > new Date()) {
    throw httpError(
      'Too many failed authenticator attempts. Try again in 15 minutes.',
      429,
      'TOTP_LOCKED',
    );
  }
}

export async function recordTotpFailure(prisma, model, user) {
  const next = (user.totpFailCount || 0) + 1;
  const data = { totpFailCount: next };
  if (next >= MAX_FAILS) {
    data.totpLockedUntil = new Date(Date.now() + LOCK_MS);
    data.totpFailCount = 0;
  }
  await prisma[model].update({ where: { id: user.id }, data });
}

export async function clearTotpFailures(prisma, model, id, extra = {}) {
  await prisma[model].update({
    where: { id },
    data: { totpFailCount: 0, totpLockedUntil: null, ...extra },
  });
}

/**
 * Verify TOTP or a one-time backup code. Persists backup consumption and lockout.
 * Throws httpError on failure.
 */
export async function consumeTotpOrBackup(prisma, model, user, { totpCode, backupCode } = {}) {
  if (!isTotpEnabled(user) || !user.totpSecretEnc) {
    throw httpError(
      'Turn on an authenticator app in Settings before you can continue.',
      403,
      'TOTP_REQUIRED',
    );
  }
  assertTotpUnlocked(user);

  const digits = String(totpCode || '').replace(/\s/g, '');
  const backup = normalizeBackup(backupCode);

  if (/^\d{6}$/.test(digits)) {
    const secret = decryptSecret(user.totpSecretEnc);
    if (verifyTotpCode(secret, user.email, digits)) {
      await clearTotpFailures(prisma, model, user.id);
      return { usedBackup: false };
    }
  } else if (backup.length >= 8) {
    const result = await consumeBackupCode(user.backupCodesHash, backup);
    if (result.ok) {
      await clearTotpFailures(prisma, model, user.id, { backupCodesHash: result.remaining });
      return { usedBackup: true };
    }
  } else {
    throw httpError('Authenticator code is required', 400, 'TOTP_MISSING');
  }

  await recordTotpFailure(prisma, model, user);
  throw httpError('Invalid authenticator code', 401, 'TOTP_INVALID');
}

export function totpErrorPayload(err) {
  if (err.statusCode) {
    return { status: err.statusCode, body: { error: err.message, code: err.code } };
  }
  return null;
}
