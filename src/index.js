import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import ownerRoutes from './routes/owner.js';
import portalRoutes from './routes/portal.js';
import routerRoutes from './routes/router.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import { contributorAuthRoutes, contributorApiRoutes } from './routes/contributor.js';
import { campayWebhook } from './controllers/portalController.js';
import { openwaWebhook } from './controllers/openwaWebhookController.js';
import { serveOwnerLogo } from './controllers/mediaController.js';
import logger from './utils/logger.js';
import { runRouterHealthJob } from './services/routerHealth.js';
import { getStorageMode, isR2Configured } from './services/objectStorage.js';
import { assertProductionEnv } from './utils/env.js';
import { reconcilePendingWithdrawals } from './services/reconcileWithdrawals.js';
import { runSessionNotificationJob } from './services/sessionNotifications.js';

assertProductionEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');
const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

/** MikroTik login.html is served from the router; phones POST with that private Origin. */
function isCaptivePortalOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    if (hostname === 'login.hotspot' || hostname.includes('hotspot')) return true;

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  } catch {
    return false;
  }
}

const corsOrigin = (origin, callback) => {
  // Never callback(error) — that becomes a JSON 500 and breaks captive form POSTs.
  if (!origin) return callback(null, true);
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
    return callback(null, true);
  }
  const allowed = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (origin === allowed) return callback(null, true);
  if (isCaptivePortalOrigin(origin)) return callback(null, true);
  return callback(null, false);
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith('/webhooks/openwa')) {
      req.rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: false }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/portal') || req.path.startsWith('/api/router'),
});
app.use(globalLimiter);

const portalPayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/uploads', express.static(uploadsDir));

app.get('/media/logos/:filename', serveOwnerLogo);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contributor/auth', contributorAuthRoutes);
app.use('/api/contributor', contributorApiRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/portal/:routerToken/pay', portalPayLimiter);
app.use('/portal/:routerToken/redeem', portalPayLimiter);
app.use('/portal/:routerToken/redeem-connect', portalPayLimiter);
app.use('/portal', portalRoutes);
app.use('/api/router', routerRoutes);
app.use('/api/admin', adminRoutes);
app.post('/webhooks/campay', campayWebhook);
app.post('/webhooks/openwa', openwaWebhook);

if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }
}

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

app.listen(PORT, () => {
  logger.info(`SpaiHub API running on port ${PORT}`);
  logger.info(`Logo storage: ${getStorageMode()}${isR2Configured() ? ` (bucket ${process.env.R2_BUCKET})` : ''}`);
  runRouterHealthJob().catch((err) => {
    logger.warn('Initial router health job failed', { error: err.message });
  });
  setInterval(() => {
    runRouterHealthJob().catch((err) => {
      logger.warn('Router health job failed', { error: err.message });
    });
  }, 2 * 60 * 1000);
  setInterval(() => {
    reconcilePendingWithdrawals().catch((err) => {
      logger.warn('Withdrawal reconciliation failed', { error: err.message });
    });
  }, 5 * 60 * 1000);
  setInterval(() => {
    runSessionNotificationJob().catch((err) => {
      logger.warn('Session notification job failed', { error: err.message });
    });
  }, 5 * 60 * 1000);
});
