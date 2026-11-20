import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection, requireCompanyMembership, requirePermission } from '../../middleware/companyAccess.js';
import * as controller from './controller.js';

const router = Router();

router.use('/companies/:companyId', authenticate, requireCompanyMembership, csrfProtection);
router.get('/companies/:companyId', requirePermission('company:read'), controller.getCompany);
router.patch('/companies/:companyId', requirePermission('company:update'), controller.updateCompany);
router.get('/companies/:companyId/members', requirePermission('members:read'), controller.listMembers);
router.post('/companies/:companyId/members', requirePermission('members:manage'), controller.createMember);
router.patch('/companies/:companyId/members/:memberId', requirePermission('members:manage'), controller.changeMemberRole);
router.post('/companies/:companyId/members/:memberId/suspend', requirePermission('members:manage'), controller.suspendMember);
router.delete('/companies/:companyId/members/:memberId', requirePermission('members:manage'), controller.deleteMember);
router.post('/companies/:companyId/members/:memberId/reactivate', requirePermission('members:manage'), controller.reactivateMember);
router.get('/companies/:companyId/invitations', requirePermission('members:read'), controller.listInvitations);
router.post('/companies/:companyId/invitations', requirePermission('members:manage'), controller.createInvitation);
router.get('/companies/:companyId/verification-policy', requirePermission('company:read'), controller.getCompanyVerificationPolicy);
router.patch('/companies/:companyId/verification-policy', requirePermission('verification-policy:manage'), controller.updateCompanyVerificationPolicy);

router.post('/invitations/accept', authenticate, csrfProtection, controller.acceptInvitation);

export default router;
