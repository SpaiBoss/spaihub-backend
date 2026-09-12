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
  verifyWithdrawalCampay,
  activateOwner,
  reconcilePayment,
  listManagedLocations,
  getManagedLocation,
  updateManagedLocationStatus,
  deleteManagedLocation,
  updateManagedPackageStatus,
  deleteManagedPackage,
} from '../controllers/adminController.js';
import { exportAdminAccountingReport } from '../controllers/reportsController.js';
import {
  listContributors,
  activateContributor,
  updateContributorStatus,
  listContributorLinks,
  createContributorLink,
  updateContributorLink,
  getContributorLink,
  postContributorLinkMeter,
  listContributorWithdrawals,
  processContributorWithdrawal,
  listAdminLocations,
} from '../controllers/adminContributorController.js';

const router = Router();

router.use(authenticateAdmin);

router.get('/stats', getPlatformStats);
router.get('/stats/revenue-chart', getPlatformRevenueChart);
router.get('/owners', getOwners);
router.patch('/owners/:id/status', updateOwnerStatus);
router.post('/owners/:id/activate', activateOwner);
router.get('/transactions', getAllTransactions);
router.post('/transactions/:id/reconcile', reconcilePayment);
router.get('/transactions/export', exportAdminTransactions);
router.get('/reports/accounting', exportAdminAccountingReport);
router.get('/withdrawals', getWithdrawals);
router.get('/withdrawals/:id/campay-check', verifyWithdrawalCampay);
router.post('/withdrawals/:id/process', processWithdrawal);

router.get('/contributors', listContributors);
router.post('/contributors/:id/activate', activateContributor);
router.patch('/contributors/:id/status', updateContributorStatus);
/** Thin list for contributor-link dropdowns */
router.get('/locations', listAdminLocations);
/** Paginated ops list + detail / status / delete */
router.get('/managed-locations', listManagedLocations);
router.get('/managed-locations/:id', getManagedLocation);
router.patch('/managed-locations/:id/status', updateManagedLocationStatus);
router.delete('/managed-locations/:id', deleteManagedLocation);
router.patch('/packages/:id/status', updateManagedPackageStatus);
router.delete('/packages/:id', deleteManagedPackage);
router.get('/contributor-links', listContributorLinks);
router.post('/contributor-links', createContributorLink);
router.get('/contributor-links/:id', getContributorLink);
router.patch('/contributor-links/:id', updateContributorLink);
router.post('/contributor-links/:id/meters', postContributorLinkMeter);
router.get('/contributor-withdrawals', listContributorWithdrawals);
router.post('/contributor-withdrawals/:id/process', processContributorWithdrawal);

export default router;
