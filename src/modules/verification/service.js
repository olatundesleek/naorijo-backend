import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { hashVerificationCode, hashSessionToken } from '../../utils/crypto.js';

const invalidResult = { result: 'INVALID', message: 'The item or code could not be verified.' };

async function recordUnknown(publicToken, eventType, requestMetadata) {
  await prisma.securityEvent.create({
    data: {
      eventType,
      tokenHash: hashSessionToken(publicToken),
      ipAddress: requestMetadata.ip,
      userAgent: requestMetadata.userAgent?.slice(0, 512)
    }
  });
}

export async function openVerificationPage(publicToken, requestMetadata) {
  const item = await prisma.item.findUnique({ where: { publicToken }, select: { id: true } });
  if (item) {
    await prisma.verificationEvent.create({
      data: { itemId: item.id, eventType: 'PAGE_OPENED', ipAddress: requestMetadata.ip, userAgent: requestMetadata.userAgent?.slice(0, 512) }
    });
  } else {
    await recordUnknown(publicToken, 'unknown_public_token_open', requestMetadata);
  }
  return { status: 'CODE_REQUIRED', message: 'Enter the concealed code on the product label to verify this item.' };
}

export async function submitVerification(publicToken, body, requestMetadata) {
  const { code } = body;
  const item = await prisma.item.findUnique({
    where: { publicToken },
    include: {
      batch: {
        include: {
          product: {
            include: { company: { select: { id: true, name: true, isActive: true } } }
          }
        }
      },
      verificationEvents: {
        where: { eventType: 'VERIFICATION_SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { createdAt: true }
      }
    }
  });
  if (!item) {
    await recordUnknown(publicToken, 'unknown_public_token_code_submission', requestMetadata);
    return { status: 400, body: invalidResult };
  }

  const submittedHash = Buffer.from(hashVerificationCode(code.toUpperCase()), 'hex');
  const storedHash = Buffer.from(item.verificationCodeHash, 'hex');
  if (!timingSafeEqual(submittedHash, storedHash)) {
    await prisma.verificationEvent.create({
      data: { itemId: item.id, eventType: 'CODE_SUBMITTED', result: 'invalid', ipAddress: requestMetadata.ip, userAgent: requestMetadata.userAgent?.slice(0, 512) }
    });
    await prisma.verificationEvent.create({
      data: { itemId: item.id, eventType: 'VERIFICATION_FAILED', result: 'invalid_code', ipAddress: requestMetadata.ip, userAgent: requestMetadata.userAgent?.slice(0, 512) }
    });
    return { status: 400, body: invalidResult };
  }

  const isExpired = item.batch.expiryDate && item.batch.expiryDate < new Date();
  const eligible = item.status === 'ACTIVE' && item.batch.product.isActive && item.batch.product.company.isActive && !isExpired;
  await prisma.verificationEvent.create({
    data: { itemId: item.id, eventType: 'CODE_SUBMITTED', result: eligible ? 'eligible' : 'ineligible', ipAddress: requestMetadata.ip, userAgent: requestMetadata.userAgent?.slice(0, 512) }
  });
  if (!eligible) {
    await prisma.verificationEvent.create({
      data: { itemId: item.id, eventType: 'VERIFICATION_BLOCKED', result: item.status.toLowerCase(), ipAddress: requestMetadata.ip }
    });
    return {
      status: 200,
      body: {
        result: item.status === 'REVOKED' ? 'REVOKED' : item.status === 'RECALLED' ? 'RECALLED' : isExpired ? 'EXPIRED' : 'UNAVAILABLE',
        message: 'This item is not eligible for positive verification.'
      }
    };
  }

  const where = { id: item.id, status: 'ACTIVE' };
  if (item.overuseAction === 'BLOCK') where.successfulUses = { lt: item.maxSuccessfulUses };
  const updated = await prisma.item.updateMany({ where, data: { successfulUses: { increment: 1 } } });
  if (updated.count !== 1) {
    await prisma.verificationEvent.create({
      data: { itemId: item.id, eventType: 'VERIFICATION_BLOCKED', result: 'successful_use_limit_reached', ipAddress: requestMetadata.ip }
    });
    return { status: 200, body: { result: 'LIMIT_REACHED', message: item.overuseMessage ?? 'This item has reached its permitted verification limit.' } };
  }

  const current = await prisma.item.findUnique({
    where: { id: item.id },
    select: { successfulUses: true, maxSuccessfulUses: true, overuseAction: true, overuseMessage: true }
  });
  const overThreshold = current.successfulUses > current.maxSuccessfulUses;
  await prisma.verificationEvent.create({
    data: {
      itemId: item.id,
      eventType: overThreshold ? 'OVERUSE_WARNING' : 'VERIFICATION_SUCCEEDED',
      result: overThreshold ? 'overuse_warning' : 'verified',
      ipAddress: requestMetadata.ip,
      userAgent: requestMetadata.userAgent?.slice(0, 512)
    }
  });
  return {
    status: 200,
    body: {
      result: overThreshold ? 'WARNING' : 'GENUINE',
      product: { name: item.batch.product.name, company: item.batch.product.company.name },
      successfulUses: current.successfulUses,
      recentSuccessfulVerifications: item.verificationEvents.map((event) => event.createdAt),
      message: overThreshold ? current.overuseMessage ?? 'This item has been verified more times than expected.' : 'This item has been successfully verified.'
    }
  };
}
