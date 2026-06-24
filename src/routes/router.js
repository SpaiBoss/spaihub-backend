import { Router } from 'express';
import { authenticateRouter } from '../middleware/routerAuth.js';
import { routerHeartbeat, getRouterCommands } from '../controllers/routerController.js';

const router = Router();

router.use(authenticateRouter);

router.post('/heartbeat', routerHeartbeat);
router.get('/commands', getRouterCommands);

export default router;
