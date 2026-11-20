import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import { sendEmail } from '../../lib/email.js';
import { hashSessionToken, normalizeEmail, randomToken } from '../../utils/crypto.js';
import { serializableTransaction } from '../../lib/serializableTransaction.js';

export async function getCompany(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, displayId: true, name: true, slug: true, isActive: true, defaultMaxSuccessfulUses: true, defaultOveruseAction: true, defaultOveruseMessage: true, createdAt: true }
  });
  if (!company) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return company;
}

export async function updateCompany(companyId, actorId, body) {
  const company = await prisma.company.update({ where: { id: companyId }, data: body, select: { id: true, displayId: true, name: true, slug: true } });
  await prisma.auditLog.create({ data: { actorId, companyId: company.id, action: 'company.updated', entityType: 'Company', entityId: company.id } });
  return company;
}

export async function listMembers(companyId) {
  return prisma.companyMember.findMany({
    where: { companyId },
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true } }
    }
  });
}

async function findMember(companyId, memberId, db = prisma) {
  const member = await db.companyMember.findFirst({ where: { id: memberId, companyId } });
  if (!member) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return member;
}

async function ensureAdminRemains(tx, companyId, member) {
  if (member.role !== 'ADMIN' || member.status !== 'ACTIVE') return;
  const admins = await tx.companyMember.count({ where: { companyId, role: 'ADMIN', status: 'ACTIVE' } });
  if (admins <= 1) throw new AppError(409, 'LAST_ADMIN', 'Transfer administrator access before changing the last active Admin');
}

export async function changeMemberRole(companyId, memberId, actorId, body) {
  const { role } = body;
  const updated = await serializableTransaction(async (tx) => {
    const member = await findMember(companyId, memberId, tx);
    if (role !== 'ADMIN') await ensureAdminRemains(tx, companyId, member);
    const result = await tx.companyMember.update({ where: { id: member.id }, data: { role } });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'member.role_changed', entityType: 'CompanyMember', entityId: member.id, metadata: { previousRole: member.role, role } }
    });
    return result;
  });
  return { id: updated.id, role: updated.role, status: updated.status };
}

export async function suspendMember(companyId, memberId, actorId) {
  await serializableTransaction(async (tx) => {
    const member = await findMember(companyId, memberId, tx);
    await ensureAdminRemains(tx, companyId, member);
    await tx.companyMember.update({ where: { id: member.id }, data: { status: 'SUSPENDED' } });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'member.suspended', entityType: 'CompanyMember', entityId: member.id }
    });
  });
}

export async function deleteMember(companyId, memberId, actorId) {
  await serializableTransaction(async (tx) => {
    const member = await findMember(companyId, memberId, tx);
    await ensureAdminRemains(tx, companyId, member);
    await tx.companyMember.delete({ where: { id: member.id } });
    await tx.auditLog.create({
      data: {
        actorId,
        companyId,
        action: 'member.deleted',
        entityType: 'CompanyMember',
        entityId: member.id,
        metadata: { userId: member.userId, role: member.role }
      }
    });
  });
}

export async function reactivateMember(companyId, memberId, actorId) {
  await serializableTransaction(async (tx) => {
    const member = await findMember(companyId, memberId, tx);
    if (member.status !== 'ACTIVE') {
      const subscription = await requireActiveSubscription(tx, companyId);
      const activeMembers = await tx.companyMember.count({ where: { companyId, status: 'ACTIVE' } });
      if (activeMembers >= subscription.plan.memberLimit) {
        throw new AppError(403, 'MEMBER_QUOTA_EXCEEDED', 'Reactivation would exceed the current plan member limit');
      }
    }
    await tx.companyMember.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'member.reactivated', entityType: 'CompanyMember', entityId: member.id }
    });
  });
}

async function requireActiveSubscription(tx, companyId) {
  const subscription = await tx.subscription.findFirst({
    where: {
      companyId,
      status: { in: ['ACTIVE', 'TRIALING'] },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
      plan: { isActive: true }
    },
    orderBy: { createdAt: 'desc' },
    include: { plan: true }
  });
  if (!subscription) throw new AppError(403, 'SUBSCRIPTION_REQUIRED', 'An active subscription is required for membership changes');
  return subscription;
}

export async function createInvitation(companyId, actorId, body) {
  const email = normalizeEmail(body.email);
  const token = randomToken(32);
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invitation = await prisma.$transaction(async (tx) => {
    const subscription = await requireActiveSubscription(tx, companyId);
    const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const existingMembership = await tx.companyMember.findUnique({
        where: { userId_companyId: { userId: user.id, companyId } }
      });
      if (existingMembership?.status === 'ACTIVE') throw new AppError(409, 'ALREADY_MEMBER', 'This user already has active company access');
    }
    const activeMembers = await tx.companyMember.count({ where: { companyId, status: { in: ['ACTIVE', 'INVITED'] } } });
    const outstandingInvitations = await tx.invitation.count({ where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (activeMembers + outstandingInvitations >= subscription.plan.memberLimit) {
      throw new AppError(403, 'MEMBER_QUOTA_EXCEEDED', 'Invitation would exceed the current plan member limit');
    }
    const pending = await tx.invitation.findFirst({ where: { companyId, email, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (pending) throw new AppError(409, 'INVITATION_PENDING', 'An active invitation already exists for this email');
    const created = await tx.invitation.create({
      data: { companyId, inviterId: actorId, email, role: body.role, tokenHash, expiresAt },
      select: { id: true, email: true, role: true, expiresAt: true }
    });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'member.invited', entityType: 'Invitation', entityId: created.id, metadata: { role: body.role } }
    });
    return created;
  }, { isolationLevel: 'Serializable' });

  const link = new URL('/accept-invitation', env.PUBLIC_APP_URL);
  link.hash = token;
  try {
    await sendEmail({
      to: email,
      subject: 'Invitation to join a company',
      text: `You have been invited to join a company as ${body.role}. Create or sign in to an account using this email, then accept the invitation: ${link.toString()}\nThis invitation expires in seven days.`
    });
  } catch (error) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date() } });
    throw error;
  }
  return invitation;
}

export async function acceptInvitation(userId, tokenInput) {
  const tokenHash = hashSessionToken(tokenInput);
  const now = new Date();
  return serializableTransaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: { tokenHash, acceptedAt: null, expiresAt: { gt: now } },
      include: { company: { select: { id: true, isActive: true } } }
    });
    if (!invitation || !invitation.company.isActive) throw new AppError(400, 'INVALID_INVITATION', 'Invitation is invalid or expired');
    const user = await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE', emailVerifiedAt: { not: null } }, select: { id: true, email: true } });
    if (!user || normalizeEmail(user.email) !== invitation.email) {
      throw new AppError(403, 'INVITATION_EMAIL_MISMATCH', 'Sign in with the verified email address the invitation was sent to');
    }
    const subscription = await requireActiveSubscription(tx, invitation.companyId);
    const [activeMembers, pendingInvitations] = await Promise.all([
      tx.companyMember.count({ where: { companyId: invitation.companyId, status: 'ACTIVE' } }),
      tx.invitation.count({ where: { companyId: invitation.companyId, acceptedAt: null, expiresAt: { gt: now } } })
    ]);
    if (activeMembers + pendingInvitations > subscription.plan.memberLimit) {
      throw new AppError(403, 'MEMBER_QUOTA_EXCEEDED', 'Accepting this invitation would exceed the current plan member limit');
    }
    const member = await tx.companyMember.upsert({
      where: { userId_companyId: { userId, companyId: invitation.companyId } },
      update: { role: invitation.role, status: 'ACTIVE' },
      create: { userId, companyId: invitation.companyId, role: invitation.role, status: 'ACTIVE' }
    });
    const consumed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now }
    });
    if (consumed.count !== 1) throw new AppError(400, 'INVALID_INVITATION', 'Invitation is invalid or expired');
    await tx.auditLog.create({
      data: { actorId: userId, companyId: invitation.companyId, action: 'member.invitation_accepted', entityType: 'CompanyMember', entityId: member.id }
    });
    return { id: member.id, companyId: member.companyId, role: member.role, status: member.status };
  });
}

export async function listInvitations(companyId) {
  return prisma.invitation.findMany({
    where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
  });
}

export async function updateCompanyVerificationPolicy(companyId, actorId, body) {
  const input = body;
  const company = await prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({
      where: { id: companyId },
      data: {
        ...(input.maxSuccessfulUses !== undefined ? { defaultMaxSuccessfulUses: input.maxSuccessfulUses } : {}),
        ...(input.overuseAction !== undefined ? { defaultOveruseAction: input.overuseAction } : {}),
        ...(input.overuseMessage !== undefined ? { defaultOveruseMessage: input.overuseMessage } : {})
      },
      select: { id: true, defaultMaxSuccessfulUses: true, defaultOveruseAction: true, defaultOveruseMessage: true }
    });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'verification_policy.company_updated', entityType: 'Company', entityId: companyId, metadata: input }
    });
    return updated;
  });
  return company;
}

export async function getCompanyVerificationPolicy(companyId) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: { defaultMaxSuccessfulUses: true, defaultOveruseAction: true, defaultOveruseMessage: true }
  });
}
