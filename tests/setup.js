process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SESSION_HMAC_SECRET ??= 'test-session-hmac-secret-value-at-least-32';
process.env.VERIFICATION_HMAC_SECRET ??= 'test-verification-hmac-secret-at-least-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-payment-webhook-secret-at-least-32';
process.env.PRINT_EXPORT_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
if (process.env.RUN_LIVE_INTEGRATION === 'true') {
  if (!process.env.LIVE_DATABASE_URL || !process.env.LIVE_REDIS_URL) {
    throw new Error('RUN_LIVE_INTEGRATION requires LIVE_DATABASE_URL and LIVE_REDIS_URL');
  }
  process.env.DATABASE_URL = process.env.LIVE_DATABASE_URL;
  process.env.REDIS_URL = process.env.LIVE_REDIS_URL;
}
process.env.COOKIE_SECURE = 'false';
