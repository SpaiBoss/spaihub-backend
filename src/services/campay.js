import axios from 'axios';

const CAMPAY_BASE = (process.env.CAMPAY_BASE_URL || 'https://demo.campay.net').replace(/\/$/, '');

let cachedToken = null;
let tokenExpiry = 0;

function ensureCampayConfig() {
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
    if (parts.length) return parts[0];
    const fieldErrors = Object.entries(data)
      .filter(([, v]) => Array.isArray(v) && v[0])
      .map(([k, v]) => `${k}: ${v[0]}`);
    if (fieldErrors.length) return fieldErrors[0];
  }
  if (err.response?.status === 401) {
    return 'Payment service authentication failed. Check Campay credentials.';
  }
  return 'Could not start Mobile Money payment. Check your phone number and try again.';
}

function wrapCampayError(err) {
  if (err.statusCode) throw err;
  throw Object.assign(new Error(campayErrorMessage(err)), { statusCode: 502 });
}

export async function getAccessToken() {
  ensureCampayConfig();

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(`${CAMPAY_BASE}/api/token/`, {
      username: process.env.CAMPAY_USERNAME,
      password: process.env.CAMPAY_PASSWORD,
    });

    if (!response.data?.token) {
      throw Object.assign(new Error('Payment service returned an invalid token.'), { statusCode: 502 });
    }

    cachedToken = response.data.token;
    tokenExpiry = Date.now() + 50 * 60 * 1000;
    return cachedToken;
  } catch (err) {
    wrapCampayError(err);
  }
}

export async function initiatePayment({ amount, currency = 'XAF', from, description, externalReference, redirectUrl }) {
  const token = await getAccessToken();

  try {
    const response = await axios.post(
      `${CAMPAY_BASE}/api/collect/`,
      {
        amount: String(amount),
        currency,
        from,
        description,
        external_reference: externalReference,
        redirect_url: redirectUrl,
      },
      { headers: { Authorization: `Token ${token}` } }
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
