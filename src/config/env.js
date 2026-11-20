import 'dotenv/config';
import Joi from 'joi';

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().positive().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),
  DATABASE_URL: Joi.string().min(1).required(),
  REDIS_URL: Joi.string().min(1).required(),
  SESSION_HMAC_SECRET: Joi.string().min(32).required(),
  VERIFICATION_HMAC_SECRET: Joi.string().min(32).required(),
  COOKIE_NAME: Joi.string().default('pv_session'),
  COOKIE_SECURE: Joi.string().valid('true', 'false').default('false'),
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
  SESSION_TTL_SECONDS: Joi.number().integer().min(300).default(604800),
  PUBLIC_APP_URL: Joi.string().uri().default('http://localhost:3000'),
  PUBLIC_VERIFICATION_BASE_URL: Joi.string().uri().default('http://localhost:3000/api/v1/verify'),
  PRODUCT_IMAGE_STORAGE_PROVIDER: Joi.string().valid('CLOUDINARY', 'S3').default('S3'),
  PRODUCT_IMAGE_PUBLIC_BASE_URL: Joi.string().uri({ scheme: ['https'] }).allow('').optional(),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().allow('').optional(),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().integer().positive().default(587),
  SMTP_SECURE: Joi.string().valid('true', 'false').default('false'),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  EMAIL_FROM: Joi.string().email({ tlds: { allow: false } }).default('no-reply@example.invalid'),
  PRINT_EXPORT_ENCRYPTION_KEY: Joi.string().allow('').optional(),
  PAYMENT_WEBHOOK_SECRET: Joi.string().allow('').optional()
}).unknown(true);

const { error, value } = envSchema.validate(process.env, { abortEarly: false });
if (error) throw new Error(`Invalid environment configuration: ${error.message}`);

export const env = value;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());

if (env.NODE_ENV === 'production') {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required in production');
  }
  if (!env.PRINT_EXPORT_ENCRYPTION_KEY || Buffer.from(env.PRINT_EXPORT_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('PRINT_EXPORT_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production');
  }
  if (!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET.length < 32) {
    throw new Error('PAYMENT_WEBHOOK_SECRET must be at least 32 characters in production');
  }
  if (env.PRODUCT_IMAGE_STORAGE_PROVIDER === 'CLOUDINARY' &&
    (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET)) {
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required for product image uploads');
  }
  if (env.PRODUCT_IMAGE_STORAGE_PROVIDER === 'S3' && (!env.AWS_REGION || !env.AWS_S3_BUCKET)) {
    throw new Error('AWS_REGION and AWS_S3_BUCKET are required for product image uploads');
  }
}
