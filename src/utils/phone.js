/** Local Cameroon mobile: 9 digits starting with 6 (e.g. 677123456). */
export function normalizeCameroonMobileLocal(phone) {
  if (!phone || typeof phone !== 'string') return null;

  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('237') && digits.length === 12) {
    return digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return digits.slice(1);
  }
  if (/^6\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
}

/** MTN or ORANGE based on Cameroon mobile prefixes. */
export function detectCameroonOperator(phone) {
  const local = normalizeCameroonMobileLocal(phone);
  if (!local) return null;
  if (local.startsWith('69')) return 'ORANGE';
  if (/^6[5678]/.test(local)) return 'MTN';
  return null;
}

export function paymentMethodForOperator(operator) {
  if (operator === 'MTN') return 'MTN_MOMO';
  if (operator === 'ORANGE') return 'ORANGE_MONEY';
  return null;
}

export function operatorForPaymentMethod(method) {
  if (method === 'MTN_MOMO') return 'MTN';
  if (method === 'ORANGE_MONEY') return 'ORANGE';
  return null;
}

export function validateWithdrawalPhoneMethod(phone, method) {
  const operator = detectCameroonOperator(phone);
  const expected = operatorForPaymentMethod(method);

  if (!operator) {
    return 'Could not detect mobile network. Use a valid MTN (67/68/65…) or Orange (69…) number.';
  }

  if (expected && operator !== expected) {
    const network = operator === 'MTN' ? 'MTN MoMo' : 'Orange Money';
    const selected = expected === 'MTN' ? 'MTN MoMo' : 'Orange Money';
    return `This number is ${network}, not ${selected}. Change the payment method or use the correct number.`;
  }

  return null;
}

/** Campay requires country code: 2376XXXXXXXX */
export function toCampayPhone(phone) {
  const local = normalizeCameroonMobileLocal(phone);
  return local ? `237${local}` : null;
}
