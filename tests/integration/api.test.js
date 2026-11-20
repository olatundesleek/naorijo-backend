import { beforeEach, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';
import { hashVerificationCode } from '../../src/utils/crypto.js';
import { encryptPayload } from '../../src/utils/encryptedPayload.js';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      user: { findUnique: fn(), findFirst: fn(), create: fn(), update: fn(), updateMany: fn() },
      loginSession: { create: fn(), findFirst: fn(), update: fn(), updateMany: fn() },
      userSessionRevocationOutbox: { create: fn(), findMany: fn(), update: fn() },
      emailVerificationToken: { updateMany: fn(), create: fn(), findFirst: fn() },
      passwordResetToken: { updateMany: fn(), create: fn(), findFirst: fn() },
      invitation: { create: fn(), findFirst: fn(), update: fn(), updateMany: fn(), count: fn(), findMany: fn() },
      companyMember: { findFirst: fn(), findMany: fn(), findUnique: fn(), count: fn(), upsert: fn(), update: fn(), create: fn(), delete: fn() },
      platformMember: { findFirst: fn(), findMany: fn(), findUnique: fn(), upsert: fn(), create: fn() },
      company: { findUnique: fn(), findFirst: fn(), findMany: fn(), create: fn(), update: fn() },
      product: { findFirst: fn(), findMany: fn(), create: fn(), update: fn() },
      batch: { findFirst: fn(), create: fn() },
      item: { findUnique: fn(), findFirst: fn(), findMany: fn(), create: fn(), update: fn(), updateMany: fn(), count: fn() },
      verificationEvent: { create: fn() },
      securityEvent: { create: fn() },
      auditLog: { create: fn(), findMany: fn() },
      idempotencyKey: { create: fn(), findUnique: fn() },
      subscription: { findFirst: fn(), findUnique: fn(), update: fn() },
      plan: { findMany: fn(), create: fn(), findFirst: fn() },
      printExportJob: { create: fn(), findFirst: fn(), findUnique: fn(), findMany: fn(), updateMany: fn() },
      payment: { findUnique: fn(), create: fn(), update: fn() },
      processedPaymentEvent: { create: fn(), findUnique: fn(), updateMany: fn() },
      $transaction: fn()
    },
    redis: { get: fn(), set: fn(), sAdd: fn(), expire: fn(), del: fn(), sRem: fn(), sMembers: fn(), eval: fn() },
    sendEmail: fn()
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/lib/redis.js', () => ({ redis: mocks.redis }));
vi.mock('../../src/lib/email.js', () => ({ sendEmail: mocks.sendEmail }));

const { app } = await import('../../src/app.js');
const { env } = await import('../../src/config/env.js');
const passwordHash = await argon2.hash('correct horse battery staple', { type: argon2.argon2id });
const user = {
  id: 'user-1',
  displayId: 'US000000000001',
  email: 'admin@example.com',
  passwordHash,
  firstName: 'Company',
  middleName: null,
  lastName: 'Admin',
  status: 'ACTIVE',
  emailVerifiedAt: new Date(),
  memberships: [{ companyId: 'company-1', role: 'ADMIN', company: { id: 'company-1', displayId: 'CO000000000001', name: 'Example Co' } }],
  platformMembership: null
};

function resetMocks() {
  vi.clearAllMocks();
  mocks.redis.eval.mockImplementation(async (script) => {
    if (script.includes('VALIDATE_SESSION_CACHE')) {
      return JSON.stringify({
        userId: user.id,
        sessionId: 'session-1',
        expiresAt: Date.now() + 60_000,
        csrfToken: 'csrf-value'
      });
    }
    if (script.includes('BLOCK_USER_SESSIONS')) return 'owner';
    return 1;
  });
  mocks.redis.set.mockResolvedValue('OK');
  mocks.redis.sAdd.mockResolvedValue(1);
  mocks.redis.expire.mockResolvedValue(1);
  mocks.redis.get.mockResolvedValue(JSON.stringify({ userId: user.id, expiresAt: Date.now() + 60_000, csrfToken: 'csrf-value' }));
  mocks.prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });
  mocks.prisma.loginSession.findFirst.mockResolvedValue({ id: 'session-1', userId: user.id });
  mocks.prisma.companyMember.findFirst.mockResolvedValue({ id: 'member-1', role: 'ADMIN', status: 'ACTIVE', userId: user.id, companyId: 'company-1' });
  mocks.prisma.companyMember.findMany.mockResolvedValue([]);
  mocks.prisma.company.findFirst.mockImplementation(async ({ where }) =>
    where.OR.some((condition) => condition.id === 'company-1' || condition.displayId === 'CO000000000001')
      ? { id: 'company-1' }
      : null
  );
  mocks.prisma.user.findFirst.mockResolvedValue({
    id: user.id,
    displayId: user.displayId,
    email: user.email,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName
  });
  mocks.prisma.user.findUnique.mockResolvedValue(user);
  mocks.prisma.$transaction.mockImplementation(async (callback) => {
    if (typeof callback === 'function') return callback(mocks.prisma);
    return Promise.all(callback);
  });
  mocks.prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.emailVerificationToken.create.mockResolvedValue({ id: 'email-token-1' });
  mocks.prisma.emailVerificationToken.findFirst.mockResolvedValue({ id: 'email-token-1', userId: user.id });
  mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.passwordResetToken.create.mockResolvedValue({ id: 'reset-token-1' });
  mocks.prisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-token-1', userId: user.id });
  mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.user.update.mockResolvedValue({});
  mocks.prisma.loginSession.update.mockResolvedValue({});
  mocks.prisma.loginSession.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.userSessionRevocationOutbox.create.mockResolvedValue({
    id: 'revocation-1', userId: user.id
  });
  mocks.prisma.userSessionRevocationOutbox.findMany.mockResolvedValue([]);
  mocks.prisma.userSessionRevocationOutbox.update.mockResolvedValue({});
  mocks.prisma.companyMember.findFirst.mockResolvedValue({ id: 'member-1', role: 'ADMIN', status: 'ACTIVE', companyId: 'company-1', userId: user.id });
  mocks.prisma.companyMember.findUnique.mockResolvedValue(null);
  mocks.prisma.companyMember.count.mockResolvedValue(0);
  mocks.prisma.companyMember.delete.mockResolvedValue({});
  mocks.prisma.platformMember.findFirst.mockResolvedValue(null);
  mocks.prisma.invitation.count.mockResolvedValue(0);
  mocks.prisma.invitation.findFirst.mockResolvedValue(null);
  mocks.prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.invitation.create.mockResolvedValue({ id: 'invitation-1', email: 'invitee@example.com', role: 'EDITOR', expiresAt: new Date(Date.now() + 60_000) });
  mocks.prisma.subscription.findFirst.mockResolvedValue({
    id: 'subscription-1',
    status: 'ACTIVE',
    plan: { memberLimit: 10, itemLimit: 100 },
    companyId: 'company-1'
  });
  mocks.prisma.emailVerificationToken.create.mockResolvedValue({ id: 'email-token-1' });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({});
}

beforeEach(resetMocks);

describe('authentication API with mocked infrastructure', () => {
  it('logs in with a new opaque cookie-backed session', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: ' ADMIN@example.com ', password: 'correct horse battery staple'
    }).expect(200);
    expect(response.body.user).toEqual({
      id: user.id,
      displayId: user.displayId,
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName
    });
    expect(response.body.platformMembership).toBeNull();
    expect(response.body.memberships[0].role).toBe('ADMIN');
    expect(response.headers['set-cookie'][0]).toContain(`${env.COOKIE_NAME}=`);
    const savedSession = mocks.prisma.loginSession.create.mock.calls[0][0].data;
    expect(savedSession.tokenHash).not.toBe(response.headers['set-cookie'][0].split(';')[0].split('=').at(-1));
    expect(mocks.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_SESSION_CACHE'),
      expect.objectContaining({ keys: expect.arrayContaining([expect.stringContaining('user-sessions:')]) })
    );
  });

  it('uses the Redis cache for authentication without querying PostgreSQL sessions', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .expect(200);
    expect(response.body.user.id).toBe(user.id);
    expect(mocks.prisma.loginSession.findFirst).not.toHaveBeenCalled();
  });

  it('rejects bad passwords and unavailable Redis without accepting a session', async () => {
    await request(app).post('/api/v1/auth/login').send({
      email: user.email, password: 'incorrect password'
    }).expect(401);
    mocks.redis.eval.mockRejectedValueOnce(new Error('redis offline'));
    await request(app).get('/api/v1/auth/me').set('Cookie', `${env.COOKIE_NAME}=opaque`).expect(503);
  });

  it('rejects a session invalidated in Redis without falling back to PostgreSQL', async () => {
    mocks.redis.eval.mockResolvedValueOnce(null);
    await request(app).get('/api/v1/auth/me').set('Cookie', `${env.COOKIE_NAME}=opaque`).expect(401);
    expect(mocks.prisma.loginSession.findFirst).not.toHaveBeenCalled();
  });

  it('rejects product image content that is not a supported image format', async () => {
    await request(app)
      .post('/api/v1/companies/company-1/products/product-1/image')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .set('X-CSRF-Token', 'csrf-value')
      .attach('image', Buffer.from('not an image'), { filename: 'image.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(mocks.prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('deactivates an account and durably queues session revocation', async () => {
    mocks.prisma.platformMember.findFirst.mockResolvedValue({
      id: 'platform-admin', role: 'SUPER_ADMIN', status: 'ACTIVE'
    });
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: user.id, status: 'ACTIVE' })
      .mockResolvedValueOnce({ id: user.id, status: 'INACTIVE' });
    const response = await request(app)
      .patch(`/api/v1/platform-admin/members/${user.id}/status`)
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .set('X-CSRF-Token', 'csrf-value')
      .send({})
      .expect(200);
    expect(response.body.user).toEqual({ id: user.id, status: 'INACTIVE' });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id }, data: { status: 'INACTIVE' }
    });
    expect(mocks.prisma.loginSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: user.id, revokedAt: null }
    }));
    expect(mocks.prisma.userSessionRevocationOutbox.create).toHaveBeenCalledWith({
      data: { userId: user.id }
    });
  });

  it('reports deactivation after durable scheduling when Redis session cleanup fails', async () => {
    mocks.prisma.platformMember.findFirst.mockResolvedValue({
      id: 'platform-admin', role: 'SUPER_ADMIN', status: 'ACTIVE'
    });
    mocks.redis.eval.mockImplementation(async (script) => {
      if (script.includes('VALIDATE_SESSION_CACHE')) {
        return JSON.stringify({
          userId: user.id,
          sessionId: 'session-1',
          expiresAt: Date.now() + 60_000,
          csrfToken: 'csrf-value'
        });
      }
      if (script.includes('BLOCK_USER_SESSIONS')) return 'owner';
      if (script.includes('REVOKE_USER_SESSIONS')) throw new Error('redis unavailable');
      return 1;
    });
    const response = await request(app)
      .patch(`/api/v1/platform-admin/members/${user.id}/status`)
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .set('X-CSRF-Token', 'csrf-value')
      .send({})
      .expect(200);
    expect(response.body.user.status).toBe('INACTIVE');
    expect(mocks.prisma.userSessionRevocationOutbox.create).toHaveBeenCalled();
    expect(mocks.prisma.userSessionRevocationOutbox.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attempts: { increment: 3 } })
    }));
  });
});

describe('tenant and public verification boundaries', () => {
  it("hides another tenant's resources without querying its products", async () => {
    mocks.prisma.company.findFirst.mockResolvedValueOnce(null);
    await request(app)
      .get('/api/v1/companies/company-b/products/product-b')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .expect(404);
    expect(mocks.prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('accepts a readable product reference in tenant routes', async () => {
    mocks.prisma.product.findFirst.mockResolvedValueOnce({
      id: 'product-1', displayId: 'PI000000000001', name: 'Example Product', slug: 'example-product',
      description: null, isActive: true, maxSuccessfulUses: null, overuseAction: null,
      overuseMessage: null, createdAt: new Date()
    });
    const response = await request(app)
      .get('/api/v1/companies/CO000000000001/products/PI000000000001')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.product.displayId).toBe('PI000000000001');
    expect(mocks.prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        companyId: 'company-1',
        OR: [{ id: 'PI000000000001' }, { displayId: 'PI000000000001' }]
      }
    }));
  });

  it('deletes only the scoped company membership and records the action', async () => {
    mocks.prisma.companyMember.count.mockResolvedValue(2);
    await request(app)
      .delete('/api/v1/companies/company-1/members/member-1')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .set('X-CSRF-Token', 'csrf-value')
      .expect(204);
    expect(mocks.prisma.companyMember.delete).toHaveBeenCalledWith({ where: { id: 'member-1' } });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        companyId: 'company-1',
        action: 'member.deleted',
        entityType: 'CompanyMember',
        entityId: 'member-1',
        metadata: { userId: user.id, role: 'ADMIN' }
      }
    });
  });

  it('prevents a company from deleting its last active administrator', async () => {
    mocks.prisma.companyMember.count.mockResolvedValue(1);
    await request(app)
      .delete('/api/v1/companies/company-1/members/member-1')
      .set('Cookie', `${env.COOKIE_NAME}=opaque`)
      .set('X-CSRF-Token', 'csrf-value')
      .expect(409);
    expect(mocks.prisma.companyMember.delete).not.toHaveBeenCalled();
  });

  describe('remaining account and tenant endpoints', () => {
    it('does not expose public user registration', async () => {
      await request(app).post('/api/v1/auth/register').send({
        email: 'new@example.com', password: 'strong password 123',
        firstName: 'New', lastName: 'User'
      }).expect(404);
      expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    });

    it('lets a visitor register a company and become its first admin', async () => {
      mocks.prisma.user.create.mockResolvedValue({
        id: 'new-user',
        displayId: 'US000000000002',
        email: 'new@example.com',
        firstName: 'New',
        middleName: null,
        lastName: 'User'
      });
      mocks.prisma.company.create.mockResolvedValue({
        id: 'new-company',
        displayId: 'CO000000000002',
        name: 'New Company',
        slug: 'new-company'
      });
      mocks.prisma.companyMember.create.mockResolvedValue({ id: 'new-member' });

      const response = await request(app).post('/api/v1/auth/register-company').send({
        email: 'new@example.com',
        password: 'strong password 123',
        firstName: 'New',
        lastName: 'User',
        companyName: 'New Company'
      }).expect(201);

      expect(response.body.user).toMatchObject({
        email: 'new@example.com',
        verificationRequired: true
      });
      expect(response.body.company).toMatchObject({ name: 'New Company', slug: 'new-company' });
      expect(mocks.prisma.companyMember.create).toHaveBeenCalledWith({
        data: { userId: 'new-user', companyId: 'new-company', role: 'ADMIN' }
      });
      expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'new-user',
          companyId: 'new-company',
          action: 'company.registered',
          entityType: 'Company',
          entityId: 'new-company'
        }
      });
    });

    it('creates a pending company user and attaches the company role', async () => {
      mocks.prisma.user.create.mockResolvedValue({
        id: 'new-user',
        displayId: 'US000000000002',
        email: 'new@example.com',
        firstName: 'New',
        middleName: null,
        lastName: 'User'
      });
      mocks.prisma.companyMember.create.mockResolvedValue({ id: 'new-member' });
      const response = await request(app)
        .post('/api/v1/companies/company-1/members')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ email: 'new@example.com', password: 'strong password 123', firstName: 'New', lastName: 'User', role: 'EDITOR' })
        .expect(201);
      expect(response.body.membership).toEqual({ companyId: 'company-1', role: 'EDITOR' });
      expect(mocks.prisma.companyMember.create).toHaveBeenCalledWith({
        data: { userId: 'new-user', companyId: 'company-1', role: 'EDITOR', status: 'ACTIVE' }
      });
      const saved = mocks.prisma.emailVerificationToken.create.mock.calls[0][0].data;
      expect(saved.tokenHash).not.toBe(mocks.sendEmail.mock.calls[0][0].text.match(/#(.+)\n/)[1]);
    });

    it('creates platform users with an independent platform role membership', async () => {
      mocks.prisma.platformMember.findFirst.mockResolvedValue({ id: 'platform-admin', role: 'SUPER_ADMIN', status: 'ACTIVE' });
      mocks.prisma.user.create.mockResolvedValue({
        id: 'new-platform-user',
        displayId: 'US000000000003',
        email: 'platform@example.com',
        firstName: 'Platform',
        middleName: null,
        lastName: 'User'
      });
      mocks.prisma.platformMember.create.mockResolvedValue({ id: 'new-platform-member' });
      const response = await request(app)
        .post('/api/v1/platform-admin/members')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ email: 'platform@example.com', password: 'strong password 123', firstName: 'Platform', lastName: 'User', role: 'PLATFORM_SUPPORT' })
        .expect(201);
      expect(response.body.platformMembership).toEqual({ role: 'PLATFORM_SUPPORT' });
      expect(mocks.prisma.platformMember.create).toHaveBeenCalledWith({
        data: { userId: 'new-platform-user', role: 'PLATFORM_SUPPORT', status: 'ACTIVE' }
      });
    });

    it('prevents a Platform Admin from granting elevated platform roles', async () => {
      mocks.prisma.platformMember.findFirst.mockResolvedValue({ id: 'platform-admin', role: 'PLATFORM_ADMIN', status: 'ACTIVE' });
      await request(app)
        .post('/api/v1/platform-admin/members')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ email: 'platform@example.com', password: 'strong password 123', firstName: 'Platform', lastName: 'User', role: 'SUPER_ADMIN' })
        .expect(403);
      expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    });

    it('denies platform actions to roles without the required permission', async () => {
      mocks.prisma.platformMember.findFirst.mockResolvedValue({ id: 'platform-support', role: 'PLATFORM_SUPPORT', status: 'ACTIVE' });
      await request(app)
        .get('/api/v1/platform-admin/plans')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .expect(403);
      expect(mocks.prisma.plan.findMany).not.toHaveBeenCalled();
    });

    it('accepts verification tokens once and activates only pending accounts', async () => {
      await request(app).post('/api/v1/auth/verify-email').send({ token: 'verification-token-01234567890123456789' }).expect(200, { verified: true });
      expect(mocks.prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'email-token-1', usedAt: null })
      }));
      expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: user.id, status: 'PENDING', emailVerifiedAt: null },
        data: expect.objectContaining({ status: 'ACTIVE' })
      }));
    });

    it('returns a generic password-reset response and sends a single-use reset email', async () => {
      mocks.prisma.user.findUnique.mockResolvedValueOnce({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        status: 'ACTIVE',
        emailVerifiedAt: user.emailVerifiedAt
      });
      const response = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
      expect(response.body.accepted).toBe(true);
      expect(mocks.prisma.passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: user.id, expiresAt: expect.any(Date) })
      }));
      expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Reset your password' }));
    });

    it('consumes a password reset token, changes the password, and revokes sessions', async () => {
      const response = await request(app).post('/api/v1/auth/reset-password').send({
        token: 'reset-token-012345678901234567890123',
        password: 'new secure password 123'
      }).expect(200);
      expect(response.body).toEqual({ reset: true });
      expect(mocks.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'reset-token-1', usedAt: null })
      }));
      expect(mocks.prisma.loginSession.updateMany).toHaveBeenCalled();
      expect(mocks.prisma.userSessionRevocationOutbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: user.id,
          blockOperationId: expect.any(String)
        })
      });
    });

    it('creates company invitations with a hashed token and an enforced plan limit', async () => {
      const response = await request(app)
        .post('/api/v1/companies/CO000000000001/invitations')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ email: 'invitee@example.com', role: 'EDITOR' })
        .expect(201);
      expect(response.body.invitation.email).toBe('invitee@example.com');
      const tokenHash = mocks.prisma.invitation.create.mock.calls[0][0].data.tokenHash;
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Invitation to join a company' }));
    });

    it('accepts an invitation only for the signed-in matching email', async () => {
      const token = 'invitation-token-012345678901234567890123';
      mocks.prisma.invitation.findFirst.mockResolvedValueOnce({
        id: 'invitation-1',
        companyId: 'company-1',
        email: user.email,
        role: 'EDITOR',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        company: { id: 'company-1', isActive: true }
      });
      mocks.prisma.companyMember.upsert.mockResolvedValueOnce({
        id: 'member-2', companyId: 'company-1', role: 'EDITOR', status: 'ACTIVE'
      });
      const response = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ token })
        .expect(200);
      expect(response.body.member.role).toBe('EDITOR');
      expect(mocks.prisma.invitation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
      }));
      expect(mocks.prisma.companyMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId_companyId: { userId: user.id, companyId: 'company-1' } }
      }));
    });

    it('updates tenant verification policy only via the policy permission', async () => {
      mocks.prisma.company.update.mockResolvedValue({
        id: 'company-1', defaultMaxSuccessfulUses: 3, defaultOveruseAction: 'BLOCK', defaultOveruseMessage: 'Check item'
      });
      const response = await request(app)
        .patch('/api/v1/companies/company-1/verification-policy')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .send({ maxSuccessfulUses: 3, overuseAction: 'BLOCK', overuseMessage: 'Check item' })
        .expect(200);
      expect(response.body.policy.defaultOveruseAction).toBe('BLOCK');
    });

    it('downloads an encrypted print export once with no-store headers', async () => {
      const encrypted = encryptPayload([{ id: 'item-1', verificationCode: 'ABCDEF0123456789ABCD' }]);
      mocks.prisma.printExportJob.findFirst.mockResolvedValueOnce({ id: 'export-1', ...encrypted });
      mocks.prisma.printExportJob.updateMany.mockResolvedValueOnce({ count: 1 });
      const response = await request(app)
        .post('/api/v1/companies/company-1/print-exports/export-1/download')
        .set('Cookie', `${env.COOKIE_NAME}=opaque`)
        .set('X-CSRF-Token', 'csrf-value')
        .expect(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.body.items[0].verificationCode).toBe('ABCDEF0123456789ABCD');
      expect(mocks.prisma.printExportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ payloadCiphertext: '' })
      }));
    });
  });

  describe('payment webhook API', () => {
    it('authenticates signed events and rejects invalid signatures before processing', async () => {
      await request(app).post('/api/v1/webhooks/payments/provider')
        .set('Content-Type', 'application/json')
        .set('X-Payment-Signature', 't=1,v1=bad')
        .send({ id: 'evt-bad', type: 'payment.succeeded', data: {} })
        .expect(401);
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('processes a valid payment event and activates the paid subscription', async () => {
      const body = JSON.stringify({
        id: 'evt-paid-1',
        type: 'payment.succeeded',
        data: { subscriptionId: 'subscription-1', providerReference: 'pay-ref-1', amount: '10.00', currency: 'USD' }
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const { createHmac } = await import('node:crypto');
      const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
      mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
        id: 'subscription-1',
        companyId: 'company-1',
        status: 'TRIALING',
        currentPeriodEnd: null,
        canceledAt: null,
        plan: { price: { toFixed: () => '10.00' }, currency: 'USD', periodDays: 30 }
      });
      mocks.prisma.payment.findUnique.mockResolvedValueOnce(null);
      mocks.prisma.payment.create.mockResolvedValueOnce({ id: 'payment-1' });
      mocks.prisma.processedPaymentEvent.create.mockResolvedValueOnce({ id: 'event-1' });
      mocks.prisma.processedPaymentEvent.updateMany.mockResolvedValueOnce({ count: 1 });
      mocks.prisma.subscription.update.mockResolvedValueOnce({});

      const response = await request(app)
        .post('/api/v1/webhooks/payments/provider')
        .set('Content-Type', 'application/json')
        .set('X-Payment-Signature', `t=${timestamp},v1=${signature}`)
        .send(body)
        .expect(200);
      expect(response.body).toEqual({ received: true, duplicate: false });
      expect(mocks.prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', currentPeriodEnd: expect.any(Date) })
      }));
    });

    it('treats a repeated signed event with the same payload as idempotent', async () => {
      const body = JSON.stringify({
        id: 'evt-paid-duplicate',
        type: 'payment.succeeded',
        data: { subscriptionId: 'subscription-1', providerReference: 'pay-ref-duplicate', amount: '10.00', currency: 'USD' }
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const { createHmac, createHash } = await import('node:crypto');
      const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
      const duplicate = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mocks.prisma.processedPaymentEvent.create.mockRejectedValueOnce(duplicate);
      mocks.prisma.processedPaymentEvent.findUnique.mockResolvedValueOnce({
        id: 'event-existing',
        payloadHash: createHash('sha256').update(Buffer.from(body)).digest('hex')
      });
      const response = await request(app)
        .post('/api/v1/webhooks/payments/provider')
        .set('Content-Type', 'application/json')
        .set('X-Payment-Signature', `t=${timestamp},v1=${signature}`)
        .send(body)
        .expect(200);
      expect(response.body).toEqual({ received: true, duplicate: true });
      expect(mocks.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('does not apply a second success event to an already-paid provider reference', async () => {
      const body = JSON.stringify({
        id: 'evt-payment-ref-repeat',
        type: 'payment.succeeded',
        data: { subscriptionId: 'subscription-1', providerReference: 'pay-ref-already-paid', amount: '10.00', currency: 'USD' }
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const { createHmac } = await import('node:crypto');
      const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
      mocks.prisma.processedPaymentEvent.create.mockResolvedValueOnce({ id: 'new-event' });
      mocks.prisma.subscription.findUnique.mockResolvedValueOnce({
        id: 'subscription-1', companyId: 'company-1', status: 'ACTIVE', currentPeriodEnd: new Date(), canceledAt: null,
        plan: { price: { toFixed: () => '10.00' }, currency: 'USD', periodDays: 30 }
      });
      mocks.prisma.payment.findUnique.mockResolvedValueOnce({ id: 'payment-existing', subscriptionId: 'subscription-1', status: 'SUCCEEDED' });
      const response = await request(app)
        .post('/api/v1/webhooks/payments/provider')
        .set('Content-Type', 'application/json')
        .set('X-Payment-Signature', `t=${timestamp},v1=${signature}`)
        .send(body)
        .expect(200);
      expect(response.body).toEqual({ received: true, duplicate: true });
      expect(mocks.prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  it('records a page open without consuming a successful-use allowance', async () => {
    mocks.prisma.item.findUnique.mockResolvedValueOnce({ id: 'item-1' });
    await request(app).get('/api/v1/verify/public-token').expect(200, {
      status: 'CODE_REQUIRED',
      message: 'Enter the concealed code on the product label to verify this item.'
    });
    expect(mocks.prisma.verificationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'PAGE_OPENED', itemId: 'item-1' })
    }));
    expect(mocks.prisma.item.updateMany).not.toHaveBeenCalled();
  });

  it('does not consume an allowance or log the submitted secret for an incorrect code', async () => {
    const correctCode = '123456789012';
    mocks.prisma.item.findUnique.mockResolvedValueOnce({
      id: 'item-1',
      verificationCodeHash: hashVerificationCode(correctCode),
      batch: { product: { name: 'Product', isActive: true, company: { name: 'Company', isActive: true } }, expiryDate: null },
      verificationEvents: [],
      status: 'ACTIVE'
    });
    const submittedCode = '000000000000';
    await request(app).post('/api/v1/verify/public-token').send({ code: submittedCode }).expect(400);
    expect(mocks.prisma.item.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.prisma.verificationEvent.create.mock.calls)).not.toContain(submittedCode);
  });

  it('verifies a correct code and atomically increments the first allowed use', async () => {
    const code = '123456789012';
    mocks.prisma.item.findUnique
      .mockResolvedValueOnce({
        id: 'item-1',
        verificationCodeHash: hashVerificationCode(code),
        status: 'ACTIVE',
        maxSuccessfulUses: 1,
        overuseAction: 'WARN',
        overuseMessage: null,
        batch: { expiryDate: null, product: { name: 'Product', isActive: true, company: { name: 'Company', isActive: true } } },
        verificationEvents: []
      })
      .mockResolvedValueOnce({ successfulUses: 1, maxSuccessfulUses: 1, overuseAction: 'WARN', overuseMessage: null });
    mocks.prisma.item.updateMany.mockResolvedValueOnce({ count: 1 });
    const response = await request(app).post('/api/v1/verify/public-token').send({ code }).expect(200);
    expect(response.body.result).toBe('GENUINE');
    expect(response.body.successfulUses).toBe(1);
    expect(mocks.prisma.item.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1', status: 'ACTIVE' },
      data: { successfulUses: { increment: 1 } }
    }));
  });

  it('blocks a further use with an atomic threshold predicate in BLOCK mode', async () => {
    const code = '123456789012';
    mocks.prisma.item.findUnique.mockResolvedValueOnce({
      id: 'item-1',
      verificationCodeHash: hashVerificationCode(code),
      status: 'ACTIVE',
      successfulUses: 1,
      maxSuccessfulUses: 1,
      overuseAction: 'BLOCK',
      overuseMessage: 'Use limit reached',
      batch: { expiryDate: null, product: { name: 'Product', isActive: true, company: { name: 'Company', isActive: true } } },
      verificationEvents: []
    });
    mocks.prisma.item.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await request(app).post('/api/v1/verify/public-token').send({ code }).expect(200);
    expect(response.body.result).toBe('LIMIT_REACHED');
    expect(mocks.prisma.item.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1', status: 'ACTIVE', successfulUses: { lt: 1 } }
    }));
  });
});
