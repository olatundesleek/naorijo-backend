import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function normalizeAmount(amount) {
  const [whole, fraction = ''] = amount.split('.');
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
}

export function verifyPaymentSignature(rawBody, signatureHeader) {
  if (!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET.length < 32) {
    throw new AppError(503, 'PAYMENT_WEBHOOK_UNAVAILABLE', 'Payment webhook signing key is not configured');
  }
  const parts = Object.fromEntries((signatureHeader ?? '').split(',').map((part) => {
    const [key, ...value] = part.split('=');
    return [key, value.join('=')];
  }));
  const timestamp = Number(parts.t);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !parts.v1) return false;
  const expected = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
    .update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
  return safeEqualHex(parts.v1, expected);
}

export async function processPaymentWebhook(rawBody, parsed) {
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  const { subscriptionId, providerReference, amount, currency } = parsed.data;
  const status = {
    'payment.succeeded': 'SUCCEEDED',
    'payment.failed': 'FAILED',
    'payment.refunded': 'REFUNDED'
  }[parsed.type];

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.processedPaymentEvent.create({
        data: { provider: 'generic-hmac', eventId: parsed.id, eventType: parsed.type, payloadHash }
      });
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true }
      });
      if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription was not found');
      if (subscription.plan.currency !== currency || subscription.plan.price.toFixed(2) !== normalizeAmount(amount)) {
        throw new AppError(400, 'PAYMENT_MISMATCH', 'Payment amount or currency does not match the subscription plan');
      }
      const existing = await tx.payment.findUnique({ where: { providerReference } });
      if (existing && existing.subscriptionId !== subscriptionId) {
        throw new AppError(409, 'PAYMENT_REFERENCE_CONFLICT', 'Payment reference is already associated with a different subscription');
      }
      if (existing && (
        existing.status === 'REFUNDED'
        || existing.status === status
        || (existing.status === 'SUCCEEDED' && status === 'FAILED')
      )) {
        await tx.processedPaymentEvent.updateMany({
          where: { provider: 'generic-hmac', eventId: parsed.id },
          data: { processedAt: new Date() }
        });
        return { received: true, duplicate: true };
      }
      const payment = existing
        ? await tx.payment.update({
          where: { id: existing.id },
          data: { status, processedAt: new Date() }
        })
        : await tx.payment.create({
          data: {
            subscriptionId, provider: 'generic-hmac', providerReference,
            amount, currency, status, processedAt: new Date()
          }
        });

      let subscriptionStatus = subscription.status;
      let currentPeriodEnd = subscription.currentPeriodEnd;
      let canceledAt = subscription.canceledAt;
      if (status === 'SUCCEEDED') {
        const periodStart = Math.max(Date.now(), currentPeriodEnd?.getTime() ?? 0);
        currentPeriodEnd = new Date(periodStart + subscription.plan.periodDays * 24 * 60 * 60 * 1000);
        subscriptionStatus = 'ACTIVE';
        canceledAt = null;
      } else if (status === 'FAILED') {
        subscriptionStatus = 'PAST_DUE';
      } else {
        subscriptionStatus = 'CANCELED';
        canceledAt = new Date();
      }
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: subscriptionStatus, currentPeriodEnd, canceledAt }
      });
      await tx.auditLog.create({
        data: {
          companyId: subscription.companyId,
          action: `payment.${status.toLowerCase()}`,
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { provider: 'generic-hmac', currency, eventId: parsed.id }
        }
      });
      await tx.processedPaymentEvent.updateMany({
        where: { provider: 'generic-hmac', eventId: parsed.id },
        data: { processedAt: new Date() }
      });
      return { received: true, duplicate: false };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2002') {
      const prior = await prisma.processedPaymentEvent.findUnique({
        where: { provider_eventId: { provider: 'generic-hmac', eventId: parsed.id } },
        select: { id: true, payloadHash: true }
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new AppError(409, 'WEBHOOK_REPLAY_CONFLICT', 'Event identifier was already used for another payload');
        return { received: true, duplicate: true };
      }
    }
    throw error;
  }
}
