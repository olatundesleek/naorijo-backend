import { serializableTransaction } from '../lib/serializableTransaction.js';

export async function expireSubscriptions() {
  const now = new Date();
  return serializableTransaction(async (tx) => {
    const expired = await tx.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] },
        currentPeriodEnd: { lte: now }
      },
      select: { id: true, companyId: true }
    });
    let count = 0;
    for (const subscription of expired) {
      const result = await tx.subscription.updateMany({
        where: { id: subscription.id, status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { lte: now } },
        data: { status: 'EXPIRED' }
      });
      if (result.count === 1) {
        count += 1;
        await tx.auditLog.create({
          data: {
            companyId: subscription.companyId,
            action: 'subscription.expired',
            entityType: 'Subscription',
            entityId: subscription.id
          }
        });
      }
    }
    return count;
  });
}
