import { AppError } from '../../middleware/errorHandler.js';
import { validate } from '../../lib/validate.js';
import { processPaymentWebhook, verifyPaymentSignature } from './service.js';
import { paymentEventSchema } from './validation.js';

export async function receivePaymentWebhook(req, res, next) {
  try {
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook request body must be JSON');
    if (!verifyPaymentSignature(req.body, req.get('x-payment-signature'))) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Payment signature is invalid or expired');
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new AppError(400, 'INVALID_WEBHOOK', 'Payment event payload is invalid');
    }
    const event = validate(paymentEventSchema, payload);
    res.json(await processPaymentWebhook(req.body, event));
  } catch (error) { next(error); }
}
