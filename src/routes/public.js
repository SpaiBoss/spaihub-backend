import { Router } from 'express';
import { getPublicConfig } from '../controllers/publicConfigController.js';

const router = Router();

router.get('/config', getPublicConfig);

export default router;
