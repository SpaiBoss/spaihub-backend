import { Router } from 'express';
import express from 'express';
import { authenticateRouter } from '../middleware/routerAuth.js';
import {
  routerHeartbeat,
  getRouterCommands,
  ackRouterCommands,
} from '../controllers/routerController.js';
import { reportHotspotActive } from '../controllers/sessionController.js';

const router = Router();

router.use(authenticateRouter);

router.post('/heartbeat', routerHeartbeat);
router.get('/commands', getRouterCommands);
router.post('/commands/ack', ackRouterCommands);
router.post(
  '/hotspot-active',
  express.text({ type: '*/*', limit: '512kb' }),
  reportHotspotActive
);

export default router;
