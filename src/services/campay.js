import axios from 'axios';

const CAMPAY_BASE = process.env.CAMPAY_BASE_URL || 'https://demo.campay.net';

let cachedToken = null;
let tokenExpiry = 0;

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const response = await axios.post(`${CAMPAY_BASE}/api/token/`, {
    username: process.env.CAMPAY_USERNAME,
    password: process.env.CAMPAY_PASSWORD,
  });

  cachedToken = response.data.token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

export async function initiatePayment({ amount, currency = 'XAF', from, description, externalReference, redirectUrl }) {
  const token = await getAccessToken();

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

  return {
    reference: response.data.reference,
    ussd_code: response.data.ussd_code,
    operator: response.data.operator,
  };
}

export async function getTransactionStatus(reference) {
  const token = await getAccessToken();

  const response = await axios.get(`${CAMPAY_BASE}/api/transaction/${reference}/`, {
    headers: { Authorization: `Token ${token}` },
  });

  return response.data;
}
