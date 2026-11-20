import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { blockUserSessions, cacheSession, releaseUserSessionBlock, revokeSessionInRedis } from '../../lib/sessionCache.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateDisplayId, hashSessionToken, normalizeEmail, randomToken, slugify } from '../../utils/crypto.js';
import { sendEmail } from '../../lib/email.js';
import { serializableTransaction } from '../../lib/serializableTransaction.js';
import { processUserSessionRevocation } from '../../jobs/retryUserSessionRevocations.js';

function safeMembership(membership) {
  return {
    companyId: membership.companyId,
    companyDisplayId: membership.company.displayId,
    companyName: membership.company.name,
    role: membership.role
  };
}

function safePlatformMembership(membership) {
  return membership ? { role: membership.role } : null;
}

function fullName(person) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');
}

async function sendEmailVerification(userId, email, name) {
  const token = randomToken(32);
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
  });
  const link = new URL('/verify-email', env.PUBLIC_APP_URL);
  link.hash = token;
  await sendEmail({
    to: email,
    subject: 'Verify your email address',
    text: `Hello ${name}, verify your email address by opening: ${link.toString()}\nThis link expires in 24 hours.`
  });
}

export async function registerCompany(input) {
  const email = normalizeEmail(input.email);
  const companySlug = slugify(input.companyName);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        displayId: generateDisplayId('US'),
        email,
        passwordHash,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        status: 'PENDING'
      }
    });
    const company = await tx.company.create({ data: { displayId: generateDisplayId('CO'), name: input.companyName, slug: companySlug } });
    await tx.companyMember.create({ data: { userId: createdUser.id, companyId: company.id, role: 'ADMIN' } });
    await tx.auditLog.create({
      data: { actorId: createdUser.id, companyId: company.id, action: 'company.registered', entityType: 'Company', entityId: company.id }
    });
    return {
      id: createdUser.id,
      displayId: createdUser.displayId,
      email: createdUser.email,
      firstName: createdUser.firstName,
      middleName: createdUser.middleName,
      lastName: createdUser.lastName,
      company
    };
  });
  await sendEmailVerification(user.id, user.email, fullName(user));
  return {
    user: {
      id: user.id,
      displayId: user.displayId,
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      verificationRequired: true
    },
    company: { id: user.company.id, displayId: user.company.displayId, name: user.company.name, slug: user.company.slug }
  };
}

export async function createCompanyUser(companyId, actorId, input) {
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await serializableTransaction(async (tx) => {
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
    const activeMembers = await tx.companyMember.count({
      where: { companyId, status: { in: ['ACTIVE', 'INVITED'] } }
    });
    const outstandingInvitations = await tx.invitation.count({
      where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } }
    });
    if (activeMembers + outstandingInvitations >= subscription.plan.memberLimit) {
      throw new AppError(403, 'MEMBER_QUOTA_EXCEEDED', 'Creating this user would exceed the current plan member limit');
    }

    const createdUser = await tx.user.create({
      data: {
        displayId: generateDisplayId('US'),
        email,
        passwordHash,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        status: 'PENDING'
      },
      select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true }
    });
    const membership = await tx.companyMember.create({
      data: { userId: createdUser.id, companyId, role: input.role, status: 'ACTIVE' }
    });
    await tx.auditLog.create({
      data: {
        actorId,
        companyId,
        action: 'member.created',
        entityType: 'CompanyMember',
        entityId: membership.id,
        metadata: { role: input.role }
      }
    });
    return createdUser;
  });
  await sendEmailVerification(user.id, user.email, fullName(user));
  return {
    user: { ...user, verificationRequired: true },
    membership: { companyId, role: input.role }
  };
}

export async function createPlatformUser(actorId, actorRole, input) {
  if (['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(input.role) && actorRole !== 'SUPER_ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only a Super Admin can assign this platform role');
  }
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        displayId: generateDisplayId('US'),
        email,
        passwordHash,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        status: 'PENDING'
      },
      select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true }
    });
    const membership = await tx.platformMember.create({
      data: { userId: createdUser.id, role: input.role, status: 'ACTIVE' }
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'platform_member.created',
        entityType: 'PlatformMember',
        entityId: membership.id,
        metadata: { role: input.role }
      }
    });
    return createdUser;
  });
  await sendEmailVerification(user.id, user.email, fullName(user));
  return {
    user: { ...user, verificationRequired: true },
    platformMembership: { role: input.role }
  };
}

export async function verifyEmail(token) {
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const verification = await tx.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } }
    });
    if (!verification) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or expired');
    const consumed = await tx.emailVerificationToken.updateMany({
      where: { id: verification.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now }
    });
    if (consumed.count !== 1) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or expired');
    const activated = await tx.user.updateMany({
      where: { id: verification.userId, status: 'PENDING', emailVerifiedAt: null },
      data: { emailVerifiedAt: now, status: 'ACTIVE' }
    });
    if (activated.count !== 1) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or expired');
    await tx.auditLog.create({
      data: { actorId: verification.userId, action: 'account.email_verified', entityType: 'User', entityId: verification.userId }
    });
    return { verified: true };
  });
}

export async function resendEmailVerification(emailInput) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, middleName: true, lastName: true, status: true, emailVerifiedAt: true }
  });
  if (!user || user.status === 'DISABLED' || user.emailVerifiedAt) return { accepted: true };
  try {
    await sendEmailVerification(user.id, user.email, fullName(user));
  } catch (error) {
    if (!(error instanceof AppError) || !error.code.startsWith('EMAIL_')) throw error;
    console.error('Verification email could not be delivered:', error.code);
  }
  return { accepted: true };
}

export async function requestPasswordReset(emailInput) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, middleName: true, lastName: true, status: true, emailVerifiedAt: true }
  });
  if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) return { accepted: true };

  const token = randomToken(32);
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  });
  const link = new URL('/reset-password', env.PUBLIC_APP_URL);
  link.hash = token;
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your password',
      text: `Hello ${fullName(user)}, reset your password by opening: ${link.toString()}\nThis link expires in one hour. If you did not request this, ignore this email.`
    });
  } catch (error) {
    if (!(error instanceof AppError) || !error.code.startsWith('EMAIL_')) throw error;
    console.error('Password reset email could not be delivered:', error.code);
  }
  return { accepted: true };
}

export async function resetPassword(token, password) {
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const pendingToken = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true }
  });
  if (!pendingToken) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');

  const operationId = randomUUID();
  let blockResult;
  try {
    blockResult = await blockUserSessions(pendingToken.userId, operationId);
  } catch {
    throw new AppError(503, 'SESSION_REVOCATION_UNAVAILABLE', 'Could not safely revoke existing sessions');
  }
  if (blockResult === 'busy') {
    throw new AppError(503, 'SESSION_REVOCATION_IN_PROGRESS', 'Account session revocation is already in progress');
  }
  const ownsBlock = blockResult === 'owner';
  let revocation;
  try {
    revocation = await prisma.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } }
      });
      if (!resetToken) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (consumed.count !== 1) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
      const updatedUser = await tx.user.updateMany({
        where: { id: resetToken.userId, status: 'ACTIVE' },
        data: { passwordHash }
      });
      if (updatedUser.count !== 1) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
      await tx.loginSession.updateMany({ where: { userId: resetToken.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: { actorId: resetToken.userId, action: 'account.password_reset', entityType: 'User', entityId: resetToken.userId }
      });
      return tx.userSessionRevocationOutbox.create({
        data: { userId: resetToken.userId, blockOperationId: ownsBlock ? operationId : null }
      });
    });
  } catch (error) {
    if (ownsBlock) {
      try {
        await releaseUserSessionBlock(pendingToken.userId, operationId);
      } catch (releaseError) {
        console.error('Could not release the Redis password-reset marker:', releaseError.message);
      }
    }
    throw error;
  }
  try {
    await processUserSessionRevocation(revocation);
  } catch (error) {
    console.error('Password-reset session revocation remains pending in the PostgreSQL outbox:', error.message);
  }
  return { reset: true };
}

export async function login(input, requestMetadata) {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: { where: { status: 'ACTIVE', company: { isActive: true } }, include: { company: { select: { id: true, displayId: true, name: true } } } },
      platformMembership: true
    }
  });
  if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt || !(await argon2.verify(user.passwordHash, input.password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const token = randomToken();
  const csrfToken = randomToken(24);
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
  const session = await prisma.loginSession.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress: requestMetadata.ip,
      userAgent: requestMetadata.userAgent?.slice(0, 512)
    }
  });
  try {
    const cached = await cacheSession({
      userId: user.id,
      tokenHash,
      ttlSeconds: env.SESSION_TTL_SECONDS,
      session: {
        userId: user.id,
        sessionId: session.id,
        expiresAt: expiresAt.getTime(),
        csrfToken
      }
    });
    if (Number(cached) !== 1) {
      await prisma.loginSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable');
    }
  } catch (error) {
    if (!(error instanceof AppError)) {
      try {
        const revocation = await prisma.$transaction(async (tx) => {
          await tx.loginSession.updateMany({
            where: { id: session.id, revokedAt: null },
            data: { revokedAt: new Date() }
          });
          return tx.userSessionRevocationOutbox.create({
            data: { userId: user.id }
          });
        });
        await processUserSessionRevocation(revocation);
      } catch (cleanupError) {
        console.error('Login session compensation remains pending or failed:', cleanupError.message);
      }
    }
    throw error;
  }

  return {
    token,
    body: {
      user: {
        id: user.id,
        displayId: user.displayId,
        email: user.email,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName
      },
      memberships: user.memberships.map(safeMembership),
      platformMembership: user.platformMembership?.status === 'ACTIVE' ? safePlatformMembership(user.platformMembership) : null,
      csrfToken
    }
  };
}

export async function getCurrentUser(userId) {
  const [user, memberships, platformMembership] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true }
    }),
    prisma.companyMember.findMany({
    where: { userId, status: 'ACTIVE', company: { isActive: true } },
    include: { company: { select: { id: true, displayId: true, name: true } } }
    }),
    prisma.platformMember.findFirst({
      where: { userId, status: 'ACTIVE' }
    })
  ]);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account is unavailable');
  return {
    user,
    memberships: memberships.map(safeMembership),
    platformMembership: safePlatformMembership(platformMembership)
  };
}

export async function logout({ sessionId, userId, tokenHash }) {
  await revokeSessionInRedis(userId, tokenHash);
  await prisma.loginSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function logoutAll(userId) {
  const operationId = randomUUID();
  let blockResult;
  try {
    blockResult = await blockUserSessions(userId, operationId);
  } catch {
    throw new AppError(503, 'SESSION_REVOCATION_UNAVAILABLE', 'Could not safely revoke existing sessions');
  }
  if (blockResult === 'busy') {
    throw new AppError(503, 'SESSION_REVOCATION_IN_PROGRESS', 'Account session revocation is already in progress');
  }
  const ownsBlock = blockResult === 'owner';
  let revocation;
  try {
    revocation = await prisma.$transaction(async (tx) => {
      await tx.loginSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return tx.userSessionRevocationOutbox.create({
        data: { userId, blockOperationId: ownsBlock ? operationId : null }
      });
    });
  } catch (error) {
    if (ownsBlock) {
      try {
        await releaseUserSessionBlock(userId, operationId);
      } catch (releaseError) {
        console.error('Could not release the Redis logout-all marker:', releaseError.message);
      }
    }
    throw error;
  }
  try {
    await processUserSessionRevocation(revocation);
  } catch (error) {
    console.error('Logout-all session revocation remains pending in the PostgreSQL outbox:', error.message);
  }
}
