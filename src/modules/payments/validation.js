import Joi from 'joi';

export const paymentEventSchema = Joi.object({
  id: Joi.string().min(1).max(200).required(),
  type: Joi.string().valid('payment.succeeded', 'payment.failed', 'payment.refunded').required(),
  data: Joi.object({
    subscriptionId: Joi.string().min(1).required(),
    providerReference: Joi.string().min(1).max(255).required(),
    amount: Joi.string().pattern(/^\d{1,8}(?:\.\d{1,2})?$/).required(),
    currency: Joi.string().length(3).uppercase().required()
  }).required()
}).required();
