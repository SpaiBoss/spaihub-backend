import { Router } from 'express';
import {
  register,
  verifyEmail,
  login,
  forgotPassword,
  validateResetToken,
  resetPassword,
} from '../controllers/authController.js';
import { adminLogin } from '../controllers/adminAuthController.js';

const router = Router();

router.post('/register', register);
router.get('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.get('/reset-password/validate', validateResetToken);
router.post('/reset-password', resetPassword);
router.post('/admin/login', adminLogin);

export default router;
