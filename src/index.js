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
import { campayWebhook } from './controllers/portalController.js';
import { serveOwnerLogo } from './controllers/mediaController.js';
import logger from './utils/logger.js';
import { runRouterHealthJob } from './services/routerHealth.js';
import { getStorageMode, isR2Configured } from './services/objectStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');
const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
const corsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
    return callback(null, true);
  }
  const allowed = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (origin === allowed) return callback(null, true);
  callback(new Error(`CORS blocked for origin: ${origin}`));
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use('/uploads', express.static(uploadsDir));

app.get('/media/logos/:filename', serveOwnerLogo);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/portal', portalRoutes);
app.use('/api/router', routerRoutes);
app.use('/api/admin', adminRoutes);
app.post('/webhooks/campay', campayWebhook);

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
});
