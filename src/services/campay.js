import axios from 'axios';

function defaultCampayBase() {
  return process.env.NODE_ENV === 'production' ? 'https://campay.net' : 'https://demo.campay.net';
}

function normalizeCampayBase(url) {
  let base = (url || defaultCampayBase()).trim().replace(/\/$/, '');
  if (base.endsWith('/api')) base = base.slice(0, -4);
  return base;
}

const CAMPAY_BASE = normalizeCampayBase(process.env.CAMPAY_BASE_URL);

export function isCampayProduction() {
  return CAMPAY_BASE.includes('campay.net') && !CAMPAY_BASE.includes('demo.');
}

let cachedToken = null;
let tokenExpiry = 0;

function ensureCampayConfig() {
  if (process.env.CAMPAY_PERMANENT_ACCESS_TOKEN?.trim()) return;
  if (!process.env.CAMPAY_USERNAME?.trim() || !process.env.CAMPAY_PASSWORD?.trim()) {
    throw Object.assign(
      new Error('Mobile Money payments are not configured yet. Please contact support.'),
      { statusCode: 503 }
    );
  }
}

function campayErrorMessage(err) {
  const data = err.response?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const parts = [data.detail, data.message, data.error, data.non_field_errors?.[0]]
      .filter((v) => typeof v === 'string' && v.trim());
    if (parts.length) {
      const message = parts[0];
      if (/unable to log in with provided credentials/i.test(message)) {
        return 'Campay API credentials are invalid. In Render, set CAMPAY_USERNAME and CAMPAY_PASSWORD to your application keys from campay.net (not your login email). Demo keys need CAMPAY_BASE_URL=https://demo.campay.net; live keys need https://campay.net.';
      }
      if (/unauthorized mtn number/i.test(message)) {
        return isCampayProduction()
          ? 'This number cannot receive MTN MoMo payouts. Use an active MTN MoMo number (67/68/650-654) or an Orange Money number (69/655-659).'
          : 'This MTN number is not authorized on Campay demo. Add it under your Campay app → Authorized numbers.';
      }
      if (/unauthorized orange/i.test(message)) {
        return isCampayProduction()
          ? 'This number cannot receive Orange Money payouts. Use an active Orange Money number (69/655-659).'
          : 'This Orange number is not authorized on Campay demo. Add it under your Campay app → Authorized numbers.';
      }
      if (/api withdrawal|withdrawal.*not enabled|withdraw.*disabled/i.test(message)) {
        return 'Campay API withdrawal is not enabled. In campay.net → Applications → your app, turn on API withdrawal.';
      }
      if (/insufficient|not enough balance/i.test(message)) {
        return 'Campay wallet balance is too low to send this withdrawal. Top up your Campay account or try a smaller amount.';
      }
      return message;
    }
    const fieldErrors = Object.entries(data)
      .filter(([, v]) => Array.isArray(v) && v[0])
      .map(([k, v]) => `${k}: ${v[0]}`);
    if (fieldErrors.length) return fieldErrors[0];
  }
  if (err.response?.status === 401) {
    return 'Campay API authentication failed. Check CAMPAY_USERNAME, CAMPAY_PASSWORD, and CAMPAY_BASE_URL on the server.';
  }
  return 'Could not start Mobile Money payment. Check your phone number and try again.';
}

function formBody(fields) {
  return new URLSearchParams(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null)
  );
}

async function campayPost(path, fields, token) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (token) headers.Authorization = `Token ${token}`;
  return axios.post(`${CAMPAY_BASE}${path}`, formBody(fields), { headers });
}

function wrapCampayError(err) {
  if (err.statusCode) throw err;
  throw Object.assign(new Error(campayErrorMessage(err)), { statusCode: 502 });
}

async function fetchTokenWithCredentials() {
  const username = process.env.CAMPAY_USERNAME.trim();
  const password = process.env.CAMPAY_PASSWORD.trim();
  const url = `${CAMPAY_BASE}/api/token/`;
  const body = { username, password };

  try {
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.data?.token) return response.data.token;
  } catch (jsonErr) {
    try {
      const response = await campayPost('/api/token/', body);
      if (response.data?.token) return response.data.token;
    } catch {
      wrapCampayError(jsonErr);
    }
  }

  throw Object.assign(new Error('Payment service returned an invalid token.'), { statusCode: 502 });
}

export async function getAccessToken() {
  ensureCampayConfig();

  const permanent = process.env.CAMPAY_PERMANENT_ACCESS_TOKEN?.trim();
  if (permanent) return permanent;

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const token = await fetchTokenWithCredentials();
    cachedToken = token;
    tokenExpiry = Date.now() + 50 * 60 * 1000;
    return cachedToken;
  } catch (err) {
    wrapCampayError(err);
  }
}

export async function initiatePayment({ amount, currency = 'XAF', from, description, externalReference, redirectUrl }) {
  const token = await getAccessToken();

  try {
    const response = await campayPost(
      '/api/collect/',
      {
        amount: String(amount),
        currency,
        from,
        description,
        external_reference: externalReference,
        redirect_url: redirectUrl,
      },
      token
    );

    if (!response.data?.reference) {
      throw Object.assign(new Error('Payment service did not return a transaction reference.'), { statusCode: 502 });
    }

    return {
      reference: response.data.reference,
      ussd_code: response.data.ussd_code,
      operator: response.data.operator,
    };
  } catch (err) {
    wrapCampayError(err);
  }
}

export async function getTransactionStatus(reference) {
  const token = await getAccessToken();

  try {
    const response = await axios.get(`${CAMPAY_BASE}/api/transaction/${reference}/`, {
      headers: { Authorization: `Token ${token}` },
    });
    return response.data;
  } catch (err) {
    wrapCampayError(err);
  }
}

export async function getHolderInfo(phoneNumber) {
  const token = await getAccessToken();
  const response = await axios.get(`${CAMPAY_BASE}/api/holder_info/`, {
    params: { phone_number: phoneNumber },
    headers: { Authorization: `Token ${token}` },
  });
  return response.data;
}

export async function getBalance() {
  const token = await getAccessToken();
  const response = await axios.get(`${CAMPAY_BASE}/api/balance/`, {
    headers: { Authorization: `Token ${token}` },
  });
  return response.data;
}

export async function initiateWithdrawal({ amount, currency = 'XAF', to, description, externalReference }) {
  const token = await getAccessToken();

  try {
    const response = await campayPost(
      '/api/withdraw/',
      {
        amount: String(amount),
        currency,
        to,
        description,
        external_reference: externalReference,
      },
      token
    );

    if (!response.data?.reference) {
      throw Object.assign(new Error('Withdrawal service did not return a transaction reference.'), {
        statusCode: 502,
      });
    }

    return {
      reference: response.data.reference,
      status: response.data.status || 'PENDING',
    };
  } catch (err) {
    wrapCampayError(err);
  }
}
