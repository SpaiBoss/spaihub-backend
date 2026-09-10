import { Router } from 'express';
import {
  registerContributor,
  verifyContributorEmail,
  loginContributor,
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

const authRouter = Router();
authRouter.post('/register', registerContributor);
authRouter.get('/verify-email', verifyContributorEmail);
authRouter.post('/resend-verification', resendContributorVerification);
authRouter.post('/login', loginContributor);
authRouter.post('/forgot-password', forgotContributorPassword);
authRouter.get('/reset-password/validate', validateContributorResetToken);
authRouter.post('/reset-password', resetContributorPassword);

const apiRouter = Router();
apiRouter.use(authenticateContributor);
apiRouter.get('/me', getContributorMe);
apiRouter.patch('/me', updateContributorMe);
apiRouter.get('/dashboard', getContributorDashboard);
apiRouter.get('/links', getContributorLinks);
apiRouter.get('/wallet', getContributorWallet);
apiRouter.post('/wallet/withdraw', requestContributorWithdrawal);

export { authRouter as contributorAuthRoutes, apiRouter as contributorApiRoutes };
