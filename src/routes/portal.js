import { Router } from 'express';
import {
  getPortal,
  getMikrotikLoginHtml,
  getMikrotikStatusHtml,
  checkSession,
  logoutSession,
  checkPaymentStatus,
  getPendingPayment,
  cancelPendingPayment,
  disconnectDevice,
  initiatePayment,
  redeemVoucher,
  redeemConnect,
} from '../controllers/portalController.js';

const router = Router();

router.get('/:routerToken/mikrotik-login.html', getMikrotikLoginHtml);
router.get('/:routerToken/mikrotik-status.html', getMikrotikStatusHtml);
router.get('/:routerToken', getPortal);
router.get('/:routerToken/session', checkSession);
router.post('/:routerToken/logout', logoutSession);
router.post('/:routerToken/disconnect-device', disconnectDevice);
router.get('/:routerToken/payment-status', checkPaymentStatus);
router.get('/:routerToken/pending-payment', getPendingPayment);
router.post('/:routerToken/cancel-payment', cancelPendingPayment);
router.post('/:routerToken/pay', initiatePayment);
router.post('/:routerToken/redeem', redeemVoucher);
router.post('/:routerToken/redeem-connect', redeemConnect);

export default router;
