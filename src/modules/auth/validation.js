import Joi from 'joi';
import { slugify } from '../../utils/crypto.js';

const email = Joi.string().trim().email({ tlds: { allow: false } }).max(254).required();
const password = Joi.string().min(12).max(128).required();
const personName = {
  firstName: Joi.string().trim().min(1).max(120).required(),
  middleName: Joi.string().trim().min(1).max(120).optional(),
  lastName: Joi.string().trim().min(1).max(120).required()
};

export const registerCompanySchema = Joi.object({
  email,
  password,
  ...personName,
  companyName: Joi.string().trim().min(1).max(160).custom((value, helpers) =>
    slugify(value) ? value : helpers.error('string.companyName')
  ).messages({ 'string.companyName': '"companyName" cannot form a valid company slug' }).required()
}).required();

export const createUserSchema = Joi.object({
  email,
  password,
  ...personName,
  role: Joi.string().valid('ADMIN', 'PRODUCT_MANAGER', 'EDITOR').required()
}).required();

export const createPlatformUserSchema = Joi.object({
  email,
  password,
  ...personName,
  role: Joi.string().valid('SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_VIEWER').required()
}).required();

export const loginSchema = Joi.object({
  email,
  password: Joi.string().min(1).max(128).required()
}).required();

export const emailSchema = Joi.object({ email }).required();
export const verifySchema = Joi.object({ token: Joi.string().min(32).max(256).required() }).required();
export const resetSchema = Joi.object({
  token: Joi.string().min(32).max(256).required(),
  password
}).required();
