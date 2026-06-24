import { Router } from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  getPlatformStats,
  getPlatformRevenueChart,
  getOwners,
  updateOwnerStatus,
  getAllTransactions,
  exportAdminTransactions,
  getWithdrawals,
  processWithdrawal,
} from '../controllers/adminController.js';
import { exportAdminAccountingReport } from '../controllers/reportsController.js';

const router = Router();

router.use(authenticateAdmin);

router.get('/stats', getPlatformStats);
router.get('/stats/revenue-chart', getPlatformRevenueChart);
router.get('/owners', getOwners);
router.patch('/owners/:id/status', updateOwnerStatus);
router.get('/transactions', getAllTransactions);
router.get('/transactions/export', exportAdminTransactions);
router.get('/reports/accounting', exportAdminAccountingReport);
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/:id/process', processWithdrawal);

export default router;
