import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function getCompanySubscription(companyId) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    include: { plan: true }
  });
  if (!subscription) return null;
  const [items, members] = await Promise.all([
    prisma.item.count({ where: { batch: { product: { companyId } } } }),
    prisma.companyMember.count({ where: { companyId, status: { in: ['ACTIVE', 'INVITED'] } } })
  ]);
  return {
    id: subscription.id,
    status: ['ACTIVE', 'TRIALING'].includes(subscription.status)
      && subscription.currentPeriodEnd
      && subscription.currentPeriodEnd <= new Date()
      ? 'EXPIRED'
      : subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      itemLimit: subscription.plan.itemLimit,
      memberLimit: subscription.plan.memberLimit,
      currency: subscription.plan.currency,
      price: subscription.plan.price
    },
    usage: { items, members }
  };
}

export async function cancelCompanySubscription(companyId, actorId) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  if (!subscription) throw new AppError(404, 'NO_ACTIVE_SUBSCRIPTION', 'No cancellable subscription exists');
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELED', canceledAt: new Date() }
    });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'subscription.canceled', entityType: 'Subscription', entityId: subscription.id }
    });
  });
  return { id: subscription.id, status: 'CANCELED' };
}
