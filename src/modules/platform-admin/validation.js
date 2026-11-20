import Joi from 'joi';

export const companyStatusSchema = Joi.object({
  isActive: Joi.boolean().required()
}).required();

export const auditQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
}).required();

export const planCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80).required(),
  price: Joi.number().min(0).required(),
  currency: Joi.string().length(3).uppercase().default('USD'),
  itemLimit: Joi.number().integer().positive().required(),
  memberLimit: Joi.number().integer().positive().required(),
  periodDays: Joi.number().integer().min(1).max(366).default(30)
}).required();

export const planUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80),
  price: Joi.number().min(0),
  currency: Joi.string().length(3).uppercase(),
  itemLimit: Joi.number().integer().positive(),
  memberLimit: Joi.number().integer().positive(),
  periodDays: Joi.number().integer().min(1).max(366),
  isActive: Joi.boolean()
}).min(1).required();

export const subscriptionAssignmentSchema = Joi.object({
  planId: Joi.string().trim().min(1).required()
}).required();

export const companyParamsSchema = Joi.object({
  companyId: Joi.string().trim().min(1).max(64).required()
}).required();

export const planParamsSchema = Joi.object({
  planId: Joi.string().trim().min(1).max(64).required()
}).required();

export const platformMemberParamsSchema = Joi.object({
  memberId: Joi.string().trim().min(1).max(64).required()
}).required();

export const userParamsSchema = Joi.object({
  userId: Joi.string().trim().min(1).max(64).required()
}).required();
