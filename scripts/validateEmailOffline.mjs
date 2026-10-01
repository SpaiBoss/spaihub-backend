import 'dotenv/config';
import { sendVerificationEmail } from '../src/services/email.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/validateEmailOffline.mjs you@example.com');
  process.exit(1);
}

try {
  await sendVerificationEmail(to, 'test-token-offline', 'en');
  console.log(`PASS verification email queued to ${to}`);
} catch (err) {
  console.error('FAIL', err.message);
  process.exit(1);
}
