import * as adminService from './service.js';
import * as authService from '../auth/service.js';
import { validate } from '../../lib/validate.js';
import { createPlatformUserSchema } from '../auth/validation.js';
import {
  auditQuerySchema,
  companyParamsSchema,
  companyStatusSchema,
  planCreateSchema,
  planParamsSchema,
  planUpdateSchema,
  subscriptionAssignmentSchema,
  userParamsSchema
} from './validation.js';

export async function listCompanies(_req, res, next) {
  try { res.json({ companies: await adminService.listCompanies() }); }
  catch (error) { next(error); }
}

export async function listPlatformMembers(_req, res, next) {
  try { res.json({ members: await adminService.listPlatformMembers() }); }
  catch (error) { next(error); }
}

export async function deactivateUser(req, res, next) {
  try {
    const { userId } = validate(userParamsSchema, req.params);
    const user = await adminService.deactivateUser(userId, req.auth.user.id);
    res.json({ user });
  } catch (error) { next(error); }
}

export async function createPlatformMember(req, res, next) {
  try {
    const member = await authService.createPlatformUser(
      req.auth.user.id,
      req.platformMembership.role,
      validate(createPlatformUserSchema, req.body)
    );
    res.status(201).json(member);
  } catch (error) { next(error); }
}

export async function setCompanyStatus(req, res, next) {
  try {
    const { companyId } = validate(companyParamsSchema, req.params);
    const company = await adminService.setCompanyStatus(companyId, req.auth.user.id, validate(companyStatusSchema, req.body));
    res.json({ company });
  } catch (error) { next(error); }
}

export async function listAuditLogs(req, res, next) {
  try { res.json(await adminService.listAuditLogs(validate(auditQuerySchema, req.query))); }
  catch (error) { next(error); }
}

export async function listPlans(_req, res, next) {
  try { res.json({ plans: await adminService.listPlans() }); }
  catch (error) { next(error); }
}

export async function createPlan(req, res, next) {
  try {
    const plan = await adminService.createPlan(req.auth.user.id, validate(planCreateSchema, req.body));
    res.status(201).json({ plan });
  } catch (error) { next(error); }
}

export async function updatePlan(req, res, next) {
  try {
    const { planId } = validate(planParamsSchema, req.params);
    const plan = await adminService.updatePlan(req.auth.user.id, planId, validate(planUpdateSchema, req.body));
    res.json({ plan });
  } catch (error) { next(error); }
}

export async function assignSubscription(req, res, next) {
  try {
    const { companyId } = validate(companyParamsSchema, req.params);
    const { planId } = validate(subscriptionAssignmentSchema, req.body);
    const subscription = await adminService.assignSubscription(req.auth.user.id, companyId, planId);
    res.status(201).json({ subscription });
  } catch (error) { next(error); }
}
