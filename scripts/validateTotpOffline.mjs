import assert from 'assert';
import * as OTPAuth from 'otpauth';
import {
  buildTotp,
  consumeBackupCode,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyTotpCode,
} from '../src/services/totp.js';

process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(64);

const secret = generateTotpSecret();
const totp = buildTotp(secret, 'owner@example.com');
const now = Date.now();
const token = totp.generate({ timestamp: now });
assert.ok(verifyTotpCode(secret.base32, 'owner@example.com', token), 'current TOTP should validate');

const packed = encryptSecret(secret.base32);
assert.strictEqual(decryptSecret(packed), secret.base32);

const codes = generateBackupCodes(10);
assert.strictEqual(codes.length, 10);
const hashes = await hashBackupCodes(codes);
const consumed = await consumeBackupCode(hashes, codes[0]);
assert.ok(consumed.ok);
assert.strictEqual(consumed.remaining.length, 9);
const again = await consumeBackupCode(consumed.remaining, codes[0]);
assert.strictEqual(again.ok, false);

const other = OTPAuth.Secret.fromBase32(secret.base32);
assert.ok(other);

console.log('PASS totp encrypt + window + backup consume');
