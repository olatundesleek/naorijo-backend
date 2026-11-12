import { Router } from 'express';
import { verificationLimiter } from '../../middleware/rateLimiters.js';
import * as controller from './controller.js';

const router = Router();

router.get('/:publicToken', verificationLimiter, controller.openPage);
router.post('/:publicToken', verificationLimiter, controller.submitCode);

export default router;
