import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashSessionToken = (token) =>
  createHmac('sha256', env.SESSION_HMAC_SECRET).update(token).digest('hex');
export const hashVerificationCode = (code) =>
  createHmac('sha256', env.VERIFICATION_HMAC_SECRET).update(code).digest('hex');

export function generateVerificationCode() {
  return randomInt(0, 1_000_000_000_000).toString().padStart(12, '0');
}

export function generateDisplayId(prefix) {
  return `${prefix}${randomInt(0, 1_000_000_000_000).toString().padStart(12, '0')}`;
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function slugify(value) {
  return value.normalize('NFKD').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
