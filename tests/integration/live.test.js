import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { generateDisplayId, hashVerificationCode } from '../../src/utils/crypto.js';
import { submitVerification } from '../../src/modules/verification/service.js';
import { generateItems } from '../../src/modules/products/service.js';
import { createInvitation } from '../../src/modules/companies/service.js';

vi.mock('../../src/lib/email.js', () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));

const enabled = process.env.RUN_LIVE_INTEGRATION === 'true'
  && Boolean(process.env.LIVE_DATABASE_URL)
  && Boolean(process.env.LIVE_REDIS_URL);
const live = enabled ? describe : describe.skip;
let prisma;
let redis;
let fixture;

live('live PostgreSQL and Redis concurrency', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.LIVE_DATABASE_URL }) });
    redis = createClient({ url: process.env.LIVE_REDIS_URL });
    redis.on('error', () => {});
    await Promise.all([prisma.$connect(), redis.connect()]);
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    fixture = await createFixture();
  }, 30_000);

  afterAll(async () => {
    if (fixture) await cleanupFixture();
    if (redis?.isOpen) await redis.quit();
    await prisma?.$disconnect();
  }, 30_000);

  it('shares Redis rate-limit state across operations', async () => {
    const key = `live-test:${fixture.companyId}`;
    try {
      const script = "local count=redis.call('INCR',KEYS[1]); if count == 1 then redis.call('EXPIRE',KEYS[1],60); end; return count";
      const values = await Promise.all(Array.from({ length: 20 }, () => redis.eval(script, { keys: [key], arguments: [] })));
      expect(values.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    } finally {
      await redis.del(key);
    }
  });

  it('enforces an item-generation quota under concurrent transactions', async () => {
    const outcomes = await Promise.allSettled([
      generateItems(fixture.companyId, fixture.batchId, fixture.userId, { count: 1 }, `quota-a-${fixture.suffix}`),
      generateItems(fixture.companyId, fixture.batchId, fixture.userId, { count: 1 }, `quota-b-${fixture.suffix}`)
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const count = await prisma.item.count({ where: { batchId: fixture.batchId } });
    expect(count).toBe(1);
  });

  it('does not overbook company seats with concurrent invitations', async () => {
    const outcomes = await Promise.allSettled([
      createInvitation(fixture.companyId, fixture.userId, { email: `seat-a-${fixture.suffix}@example.invalid`, role: 'EDITOR' }),
      createInvitation(fixture.companyId, fixture.userId, { email: `seat-b-${fixture.suffix}@example.invalid`, role: 'EDITOR' })
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const pendingCount = await prisma.invitation.count({
      where: { companyId: fixture.companyId, acceptedAt: null, expiresAt: { gt: new Date() } }
    });
    expect(pendingCount).toBe(1);
  });

  it('serializes simultaneous BLOCK verifications at the threshold', async () => {
    const code = 'ABCDEF0123456789ABCD';
    const item = await prisma.item.create({
      data: {
        displayId: generateDisplayId('IT'),
        batchId: fixture.batchId,
        publicToken: `verify-${fixture.suffix}`,
        verificationCodeHash: hashVerificationCode(code),
        maxSuccessfulUses: 1,
        overuseAction: 'BLOCK'
      }
    });
    const attempts = await Promise.all([
      submitVerification(item.publicToken, { code }, { ip: '127.0.0.1' }),
      submitVerification(item.publicToken, { code }, { ip: '127.0.0.2' })
    ]);
    expect(attempts.filter((result) => result.body.result === 'GENUINE')).toHaveLength(1);
    expect(attempts.filter((result) => result.body.result === 'LIMIT_REACHED')).toHaveLength(1);
    const stored = await prisma.item.findUnique({ where: { id: item.id }, select: { successfulUses: true } });
    expect(stored.successfulUses).toBe(1);
  });
});

async function createFixture() {
  const suffix = randomUUID();
  const company = await prisma.company.create({ data: { displayId: generateDisplayId('CO'), name: `Live ${suffix}`, slug: `live-${suffix}` } });
  const user = await prisma.user.create({
    data: {
      displayId: generateDisplayId('US'),
      email: `live-${suffix}@example.invalid`,
      firstName: 'Live',
      lastName: 'Test',
      passwordHash: 'not-used',
      emailVerifiedAt: new Date()
    }
  });
  await prisma.companyMember.create({ data: { companyId: company.id, userId: user.id, role: 'ADMIN' } });
  const plan = await prisma.plan.create({
    data: { name: `Live ${suffix}`, price: 0, currency: 'USD', itemLimit: 1, memberLimit: 2, periodDays: 1 }
  });
  await prisma.subscription.create({
    data: { companyId: company.id, planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 60_000) }
  });
  const product = await prisma.product.create({ data: { displayId: generateDisplayId('PI'), companyId: company.id, name: 'Live', slug: 'live' } });
  const batch = await prisma.batch.create({ data: { displayId: generateDisplayId('BA'), productId: product.id, batchNumber: 'LIVE' } });
  return { suffix, companyId: company.id, userId: user.id, planId: plan.id, productId: product.id, batchId: batch.id };
}

async function cleanupFixture() {
  await prisma.invitation.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.verificationEvent.deleteMany({ where: { item: { batchId: fixture.batchId } } });
  await prisma.item.deleteMany({ where: { batchId: fixture.batchId } });
  await prisma.idempotencyKey.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.printExportJob.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.batch.deleteMany({ where: { id: fixture.batchId } });
  await prisma.product.deleteMany({ where: { id: fixture.productId } });
  await prisma.payment.deleteMany({ where: { subscription: { companyId: fixture.companyId } } });
  await prisma.subscription.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.auditLog.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.companyMember.deleteMany({ where: { companyId: fixture.companyId } });
  await prisma.plan.deleteMany({ where: { id: fixture.planId } });
  await prisma.company.deleteMany({ where: { id: fixture.companyId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}
