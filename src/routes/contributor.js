import { Router } from 'express';
import {
  registerContributor,
  verifyContributorEmail,
  loginContributor,
  loginContributorTotp,
  resendContributorVerification,
  forgotContributorPassword,
  validateContributorResetToken,
  resetContributorPassword,
} from '../controllers/contributorAuthController.js';
import { authenticateContributor } from '../middleware/auth.js';
import {
  getContributorMe,
  updateContributorMe,
  getContributorDashboard,
  getContributorLinks,
  getContributorWallet,
  requestContributorWithdrawal,
} from '../controllers/contributorController.js';
import { createTotpSecurityHandlers } from '../controllers/totpSecurityController.js';
import rateLimit from 'express-rate-limit';

const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const contributorTotp = createTotpSecurityHandlers({
  model: 'contributor',
  getUser: (req) => req.contributor,
});

const authRouter = Router();
authRouter.post('/register', registerContributor);
authRouter.get('/verify-email', verifyContributorEmail);
authRouter.post('/resend-verification', resendContributorVerification);
authRouter.post('/login', loginContributor);
authRouter.post('/login/totp', loginContributorTotp);
authRouter.post('/forgot-password', forgotContributorPassword);
authRouter.get('/reset-password/validate', validateContributorResetToken);
authRouter.post('/reset-password', resetContributorPassword);

const apiRouter = Router();
apiRouter.use(authenticateContributor);
apiRouter.get('/me', getContributorMe);
apiRouter.patch('/me', updateContributorMe);
apiRouter.get('/security', contributorTotp.getSecurity);
apiRouter.post('/security/totp/start', totpLimiter, contributorTotp.start);
apiRouter.post('/security/totp/confirm', totpLimiter, contributorTotp.confirm);
apiRouter.post('/security/totp/disable', totpLimiter, contributorTotp.disable);
apiRouter.post('/security/backup-codes/regenerate', totpLimiter, contributorTotp.regenerateBackupCodes);
apiRouter.get('/dashboard', getContributorDashboard);
apiRouter.get('/links', getContributorLinks);
apiRouter.get('/wallet', getContributorWallet);
apiRouter.post('/wallet/withdraw', requestContributorWithdrawal);

export { authRouter as contributorAuthRoutes, apiRouter as contributorApiRoutes };
