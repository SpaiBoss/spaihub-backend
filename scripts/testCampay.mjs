import 'dotenv/config';
import axios from 'axios';

function normalizeCampayBase(url) {
  let base = (url || 'https://demo.campay.net').trim().replace(/\/$/, '');
  if (base.endsWith('/api')) base = base.slice(0, -4);
  return base;
}

function mask(value) {
  if (!value) return '(not set)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

async function requestToken(base, { username, password, asJson }) {
  const body = { username, password };
  const url = `${base}/api/token/`;

  if (asJson) {
    return axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
  }

  return axios.post(url, new URLSearchParams(body), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

async function main() {
  const base = normalizeCampayBase(process.env.CAMPAY_BASE_URL);
  const username = process.env.CAMPAY_USERNAME?.trim();
  const password = process.env.CAMPAY_PASSWORD?.trim();
  const permanentToken = process.env.CAMPAY_PERMANENT_ACCESS_TOKEN?.trim();

  console.log('Campay connection test');
  console.log('----------------------');
  console.log('CAMPAY_BASE_URL:', base);
  console.log('CAMPAY_USERNAME:', mask(username));
  console.log('CAMPAY_PASSWORD:', mask(password));
  console.log('CAMPAY_PERMANENT_ACCESS_TOKEN:', permanentToken ? '(set)' : '(not set)');
  console.log('');

  if (permanentToken) {
    console.log('Permanent token configured — skipping /api/token/ check.');
    console.log('OK: use CAMPAY_PERMANENT_ACCESS_TOKEN for payments.');
    return;
  }

  if (!username || !password) {
    console.error('FAIL: CAMPAY_USERNAME and CAMPAY_PASSWORD must be set in backend/.env or Render.');
    console.error('');
    console.error('Get them from https://campay.net → Applications → your app → API keys.');
    console.error('Use application username/password, NOT your Campay login email.');
    process.exit(1);
  }

  for (const mode of ['form', 'json']) {
    try {
      const response = await requestToken(base, {
        username,
        password,
        asJson: mode === 'json',
      });

      if (response.data?.token) {
        console.log(`OK: token received via ${mode} request.`);
        console.log('Credentials and CAMPAY_BASE_URL look correct.');
        return;
      }

      console.error(`FAIL (${mode}): token missing in response`, response.data);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      console.error(`FAIL (${mode}): HTTP ${status || 'network error'}`);
      if (data) console.error(JSON.stringify(data, null, 2));
    }
  }

  console.error('');
  console.error('Tips:');
  console.error('- Demo keys → CAMPAY_BASE_URL=https://demo.campay.net');
  console.error('- Live keys → CAMPAY_BASE_URL=https://www.campay.net');
  console.error('- Do not include /api in CAMPAY_BASE_URL');
  console.error('- Or set CAMPAY_PERMANENT_ACCESS_TOKEN from your Campay app dashboard');
  process.exit(1);
}

main();
