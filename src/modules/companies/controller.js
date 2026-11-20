import * as companyService from './service.js';
import * as authService from '../auth/service.js';
import { validate } from '../../lib/validate.js';
import { createUserSchema } from '../auth/validation.js';
import {
  companyPolicySchema,
  companyUpdateSchema,
  invitationSchema,
  invitationTokenSchema,
  memberRoleSchema,
  referenceParamsSchema
} from './validation.js';

export async function getCompany(req, res, next) {
  try { res.json({ company: await companyService.getCompany(req.companyMembership.companyId) }); }
  catch (error) { next(error); }
}

export async function updateCompany(req, res, next) {
  try { res.json({ company: await companyService.updateCompany(req.companyMembership.companyId, req.auth.user.id, validate(companyUpdateSchema, req.body)) }); }
  catch (error) { next(error); }
}

export async function listMembers(req, res, next) {
  try { res.json({ members: await companyService.listMembers(req.companyMembership.companyId) }); }
  catch (error) { next(error); }
}

export async function createMember(req, res, next) {
  try {
    const result = await authService.createCompanyUser(
      req.companyMembership.companyId,
      req.auth.user.id,
      validate(createUserSchema, req.body)
    );
    res.status(201).json(result);
  } catch (error) { next(error); }
}

export async function changeMemberRole(req, res, next) {
  try {
    validate(referenceParamsSchema, req.params);
    const member = await companyService.changeMemberRole(req.companyMembership.companyId, req.params.memberId, req.auth.user.id, validate(memberRoleSchema, req.body));
    res.json({ member });
  } catch (error) { next(error); }
}

export async function suspendMember(req, res, next) {
  try {
    validate(referenceParamsSchema, req.params);
    await companyService.suspendMember(req.companyMembership.companyId, req.params.memberId, req.auth.user.id);
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function deleteMember(req, res, next) {
  try {
    validate(referenceParamsSchema, req.params);
    await companyService.deleteMember(req.companyMembership.companyId, req.params.memberId, req.auth.user.id);
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function reactivateMember(req, res, next) {
  try {
    validate(referenceParamsSchema, req.params);
    await companyService.reactivateMember(req.companyMembership.companyId, req.params.memberId, req.auth.user.id);
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function createInvitation(req, res, next) {
  try {
    const invitation = await companyService.createInvitation(req.companyMembership.companyId, req.auth.user.id, validate(invitationSchema, req.body));
    res.status(201).json({ invitation });
  } catch (error) { next(error); }
}

export async function listInvitations(req, res, next) {
  try { res.json({ invitations: await companyService.listInvitations(req.companyMembership.companyId) }); }
  catch (error) { next(error); }
}

export async function acceptInvitation(req, res, next) {
  try {
    const { token } = validate(invitationTokenSchema, req.body);
    const member = await companyService.acceptInvitation(req.auth.user.id, token);
    res.json({ member });
  } catch (error) { next(error); }
}

export async function getCompanyVerificationPolicy(req, res, next) {
  try {
    const policy = await companyService.getCompanyVerificationPolicy(req.companyMembership.companyId);
    res.json({ policy });
  } catch (error) { next(error); }
}

export async function updateCompanyVerificationPolicy(req, res, next) {
  try {
    const policy = await companyService.updateCompanyVerificationPolicy(req.companyMembership.companyId, req.auth.user.id, validate(companyPolicySchema, req.body));
    res.json({ policy });
  } catch (error) { next(error); }
}
