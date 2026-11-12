import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptPayload, encryptPayload } from '../../src/utils/encryptedPayload.js';
import { verifyPaymentSignature } from '../../src/modules/payments/service.js';

describe('encrypted print payloads', () => {
  it('round-trips encrypted export data and rejects tampering', () => {
    const content = [{ id: 'item-1', verificationCode: 'ABCDEF0123456789ABCD' }];
    const encrypted = encryptPayload(content);
    expect(encrypted.payloadCiphertext).not.toContain(content[0].verificationCode);
    expect(decryptPayload(encrypted)).toEqual(content);
    expect(() => decryptPayload({ ...encrypted, payloadTag: Buffer.alloc(16).toString('base64') })).toThrow();
  });
});

describe('signed payment webhooks', () => {
  it('accepts a fresh signature and rejects changed or stale payloads', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt-1', type: 'payment.succeeded' }));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
      .update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
    expect(verifyPaymentSignature(body, `t=${timestamp},v1=${signature}`)).toBe(true);
    expect(verifyPaymentSignature(Buffer.from('changed'), `t=${timestamp},v1=${signature}`)).toBe(false);
    expect(verifyPaymentSignature(body, `t=${timestamp - 600},v1=${signature}`)).toBe(false);
  });
});
