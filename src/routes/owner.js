import { Router } from 'express';
import { authenticateOwner } from '../middleware/auth.js';
import {
  getLocations,
  createLocation,
  updateLocation,
} from '../controllers/locationController.js';
import {
  getRouters,
  addRouter,
  deleteRouter,
  getRouterSetupScript,
} from '../controllers/routerController.js';
import {
  getPackages,
  createPackage,
  updatePackage,
  deactivatePackage,
} from '../controllers/packageController.js';
import {
  getOwnerStats,
  getRevenueChart,
  getRouterStatus,
  getOwnerAnalytics,
} from '../controllers/statsController.js';
import {
  getTransactions,
  exportTransactions,
} from '../controllers/transactionController.js';
import { getWallet, requestWithdrawal } from '../controllers/walletController.js';
import {
  createVouchers,
  getVouchers,
  revokeVoucher,
  exportVouchers,
  getVoucherStats,
  exportVouchersPdf,
} from '../controllers/voucherController.js';
import {
  getBranding,
  updateBranding,
  uploadBrandingLogo,
  removeBrandingLogo,
} from '../controllers/brandingController.js';
import { exportOwnerAccountingReport } from '../controllers/reportsController.js';

const router = Router();

router.use(authenticateOwner);

router.get('/locations', getLocations);
router.post('/locations', createLocation);
router.patch('/locations/:id', updateLocation);

router.get('/locations/:locationId/routers', getRouters);
router.post('/locations/:locationId/routers', addRouter);
router.get('/locations/:locationId/routers/:routerId/setup', getRouterSetupScript);
router.delete('/locations/:locationId/routers/:routerId', deleteRouter);

router.get('/locations/:locationId/packages', getPackages);
router.post('/locations/:locationId/packages', createPackage);
router.patch('/locations/:locationId/packages/:packageId', updatePackage);
router.delete('/locations/:locationId/packages/:packageId', deactivatePackage);

router.get('/stats', getOwnerStats);
router.get('/stats/revenue-chart', getRevenueChart);
router.get('/stats/analytics', getOwnerAnalytics);
router.get('/stats/routers', getRouterStatus);

router.get('/transactions', getTransactions);
router.get('/transactions/export', exportTransactions);
router.get('/reports/accounting', exportOwnerAccountingReport);

router.get('/wallet', getWallet);
router.post('/wallet/withdraw', requestWithdrawal);

router.get('/vouchers', getVouchers);
router.get('/vouchers/stats', getVoucherStats);
router.get('/vouchers/export', exportVouchers);
router.get('/vouchers/export/pdf', exportVouchersPdf);
router.post('/locations/:locationId/vouchers', createVouchers);
router.post('/vouchers/:id/revoke', revokeVoucher);

router.get('/branding', getBranding);
router.patch('/branding', updateBranding);
router.post('/branding/logo', uploadBrandingLogo);
router.delete('/branding/logo', removeBrandingLogo);

export default router;
