import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function listCompanies() {
  return prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, displayId: true, name: true, slug: true, isActive: true, createdAt: true, _count: { select: { members: true, products: true } } }
  });
}

export async function listPlatformMembers() {
  return prisma.platformMember.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true, status: true } }
    }
  });
}

export async function setCompanyStatus(companyId, actorId, body) {
  const { isActive } = body;
  const company = await prisma.company.findFirst({
    where: { OR: [{ id: companyId }, { displayId: companyId }] },
    select: { id: true, displayId: true }
  });
  if (!company) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id: company.id }, data: { isActive }, select: { id: true, displayId: true, isActive: true } });
    await tx.auditLog.create({
      data: { actorId, action: isActive ? 'company.activated' : 'company.suspended', entityType: 'Company', entityId: company.id }
    });
    return updated;
  });
}

export async function listAuditLogs({ page }) {
  const logs = await prisma.auditLog.findMany({
    skip: (page - 1) * 50, take: 50, orderBy: { createdAt: 'desc' },
    select: { id: true, actorId: true, companyId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true }
  });
  return { logs, page, pageSize: 50 };
}

export async function listPlans() {
  return prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createPlan(actorId, body) {
  const input = body;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.plan.create({ data: input });
    await tx.auditLog.create({ data: { actorId, action: 'plan.created', entityType: 'Plan', entityId: plan.id } });
    return plan;
  });
}

export async function updatePlan(actorId, planId, body) {
  const input = body;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.plan.update({ where: { id: planId }, data: input });
    await tx.auditLog.create({
      data: { actorId, action: 'plan.updated', entityType: 'Plan', entityId: planId, metadata: input }
    });
    return plan;
  });
}

export async function assignSubscription(actorId, companyId, planId) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirst({
      where: { OR: [{ id: companyId }, { displayId: companyId }] },
      select: { id: true }
    });
    const plan = await tx.plan.findFirst({ where: { id: planId, isActive: true } });
    const existing = await tx.subscription.findFirst({ where: { companyId: company?.id, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } });
    if (!company) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Active plan was not found');
    if (existing) throw new AppError(409, 'SUBSCRIPTION_EXISTS', 'Cancel the current subscription before assigning another plan');
    const subscription = await tx.subscription.create({
      data: {
        companyId: company.id,
        planId,
        status: 'TRIALING',
        currentPeriodEnd: new Date(Date.now() + plan.periodDays * 24 * 60 * 60 * 1000)
      },
      select: { id: true, companyId: true, planId: true, status: true, currentPeriodEnd: true }
    });
    await tx.auditLog.create({
      data: { actorId, companyId: company.id, action: 'subscription.assigned', entityType: 'Subscription', entityId: subscription.id, metadata: { planId } }
    });
    return subscription;
  }, { isolationLevel: 'Serializable' });
}
