import Joi from 'joi';

const productFields = {
  name: Joi.string().trim().min(1).max(160),
  slug: Joi.string().trim().min(1).max(160),
  description: Joi.string().max(10000).allow('')
};

const batchFields = {
  batchNumber: Joi.string().trim().min(1).max(100),
  productionDate: Joi.date(),
  expiryDate: Joi.date()
};

const datesInOrder = (value, helpers) => {
  if (value.productionDate && value.expiryDate && value.expiryDate < value.productionDate) {
    return helpers.error('any.invalid');
  }
  return value;
};

export const productCreateSchema = Joi.object({
  ...productFields,
  name: productFields.name.required()
}).required();

export const productUpdateSchema = Joi.object(productFields).min(1).required();

export const batchCreateSchema = Joi.object({
  ...batchFields,
  batchNumber: batchFields.batchNumber.required()
}).custom(datesInOrder).required();

export const batchUpdateSchema = Joi.object(batchFields).min(1).custom(datesInOrder).required();

export const productPolicySchema = Joi.object({
  maxSuccessfulUses: Joi.number().integer().min(1).max(1_000_000).allow(null),
  overuseAction: Joi.string().valid('WARN', 'BLOCK').allow(null),
  overuseMessage: Joi.string().trim().max(500).allow(null)
}).min(1).required();

export const generateItemsSchema = Joi.object({
  count: Joi.number().integer().min(1).max(100).required()
}).required();

export const listItemsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(25)
}).required();

export const companyParamsSchema = Joi.object({
  companyId: Joi.string().trim().min(1).max(64).required(),
  productId: Joi.string().trim().min(1).max(64),
  batchId: Joi.string().trim().min(1).max(64),
  itemId: Joi.string().trim().min(1).max(64),
  exportJobId: Joi.string().trim().min(1).max(64)
}).required();

export const idempotencyKeySchema = Joi.string().trim().min(1).max(128).required();
