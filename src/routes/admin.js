import { Router } from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  getPlatformStats,
  getOwners,
  updateOwnerStatus,
  getAllTransactions,
  getWithdrawals,
  processWithdrawal,
} from '../controllers/adminController.js';

const router = Router();

router.use(authenticateAdmin);

router.get('/stats', getPlatformStats);
router.get('/owners', getOwners);
router.patch('/owners/:id/status', updateOwnerStatus);
router.get('/transactions', getAllTransactions);
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/:id/process', processWithdrawal);

export default router;
