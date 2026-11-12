import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection, requireCompanyMembership, requirePermission } from '../../middleware/companyAccess.js';
import * as controller from './controller.js';

const router = Router();

router.use('/companies/:companyId/billing', authenticate, requireCompanyMembership, csrfProtection);
router.get('/companies/:companyId/billing', requirePermission('billing:read'), controller.getSubscription);
router.post('/companies/:companyId/billing/cancel', requirePermission('billing:manage'), controller.cancelSubscription);

export default router;
