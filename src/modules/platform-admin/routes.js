import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { requirePlatformAccess } from '../../middleware/platformAccess.js';
import * as controller from './controller.js';

const router = Router();

router.use(authenticate);
router.get('/members', requirePlatformAccess('platform:members:read'), controller.listPlatformMembers);
router.patch('/members/:userId/status', requirePlatformAccess('platform:members:manage'), csrfProtection, controller.deactivateUser);
router.post('/members', requirePlatformAccess('platform:members:manage'), csrfProtection, controller.createPlatformMember);
router.get('/companies', requirePlatformAccess('companies:read'), controller.listCompanies);
router.patch('/companies/:companyId/status', requirePlatformAccess('companies:manage'), csrfProtection, controller.setCompanyStatus);
router.get('/audit-logs', requirePlatformAccess('audit:read'), controller.listAuditLogs);
router.get('/plans', requirePlatformAccess('plans:read'), controller.listPlans);
router.post('/plans', requirePlatformAccess('plans:manage'), csrfProtection, controller.createPlan);
router.patch('/plans/:planId', requirePlatformAccess('plans:manage'), csrfProtection, controller.updatePlan);
router.post('/companies/:companyId/subscriptions', requirePlatformAccess('subscriptions:manage'), csrfProtection, controller.assignSubscription);

export default router;
