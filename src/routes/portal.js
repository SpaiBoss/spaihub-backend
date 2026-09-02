import { Router } from 'express';
import {
  getPortal,
  getMikrotikLoginHtml,
  checkSession,
  logoutSession,
  checkPaymentStatus,
  getPendingPayment,
  cancelPendingPayment,
  initiatePayment,
  redeemVoucher,
} from '../controllers/portalController.js';

const router = Router();

router.get('/:routerToken/mikrotik-login.html', getMikrotikLoginHtml);
router.get('/:routerToken', getPortal);
router.get('/:routerToken/session', checkSession);
router.post('/:routerToken/logout', logoutSession);
router.get('/:routerToken/payment-status', checkPaymentStatus);
router.get('/:routerToken/pending-payment', getPendingPayment);
router.post('/:routerToken/cancel-payment', cancelPendingPayment);
router.post('/:routerToken/pay', initiatePayment);
router.post('/:routerToken/redeem', redeemVoucher);

export default router;
