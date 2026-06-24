import { Router } from 'express';
import {
  getPortal,
  checkSession,
  checkPaymentStatus,
  initiatePayment,
  redeemVoucher,
} from '../controllers/portalController.js';

const router = Router();

router.get('/:routerToken', getPortal);
router.get('/:routerToken/session', checkSession);
router.get('/:routerToken/payment-status', checkPaymentStatus);
router.post('/:routerToken/pay', initiatePayment);
router.post('/:routerToken/redeem', redeemVoucher);

export default router;
