import { Router } from 'express';
import * as controller from './controller.js';

const router = Router();

router.post('/provider', controller.receivePaymentWebhook);

export default router;
