import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

function encryptionKey() {
  const key = Buffer.from(env.PRINT_EXPORT_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) {
    throw new AppError(503, 'PRINT_EXPORT_UNAVAILABLE', 'Print export encryption is not configured');
  }
  return key;
}

export function encryptPayload(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    payloadCiphertext: ciphertext.toString('base64'),
    payloadNonce: nonce.toString('base64'),
    payloadTag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptPayload(payload) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.payloadNonce, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.payloadTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.payloadCiphertext, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'PRINT_EXPORT_CORRUPTED', 'Print export data could not be decrypted');
  }
}
