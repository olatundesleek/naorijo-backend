import Joi from 'joi';

export const publicTokenParamsSchema = Joi.object({
  publicToken: Joi.string().trim().min(1).max(256).required()
}).required();

export const verificationCodeSchema = Joi.object({
  code: Joi.string().pattern(/^(?:\d{12}|[A-Fa-f0-9]{20})$/).required()
}).required();
