import Joi from 'joi';

const role = Joi.string().valid('ADMIN', 'PRODUCT_MANAGER', 'EDITOR').required();
const maxSuccessfulUses = Joi.number().integer().min(1).max(1_000_000);
const overuseAction = Joi.string().valid('WARN', 'BLOCK');

export const companyUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required()
}).required();

export const memberRoleSchema = Joi.object({ role }).required();

export const invitationSchema = Joi.object({
  email: Joi.string().trim().email({ tlds: { allow: false } }).max(254).required(),
  role
}).required();

export const invitationTokenSchema = Joi.object({
  token: Joi.string().min(32).max(256).required()
}).required();

export const companyPolicySchema = Joi.object({
  maxSuccessfulUses,
  overuseAction,
  overuseMessage: Joi.string().trim().max(500).allow(null)
}).min(1).required();

export const referenceParamsSchema = Joi.object({
  companyId: Joi.string().trim().min(1).max(64).required(),
  memberId: Joi.string().trim().min(1).max(64)
}).required();
