import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { randomBytes, createHmac } from 'node:crypto';
import { generateDisplayId } from '../src/utils/crypto.js';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Refusing to seed outside NODE_ENV=development');
}
const seedUsers = [
  { email: process.env.SEED_SUPER_ADMIN_EMAIL, password: process.env.SEED_SUPER_ADMIN_PASSWORD, firstName: 'Development', lastName: 'Super Admin', platformRole: 'SUPER_ADMIN' },
  { email: process.env.SEED_COMPANY_ADMIN_EMAIL, password: process.env.SEED_COMPANY_ADMIN_PASSWORD, firstName: 'Sample', lastName: 'Company Admin', role: 'ADMIN' },
  { email: process.env.SEED_PRODUCT_MANAGER_EMAIL, password: process.env.SEED_PRODUCT_MANAGER_PASSWORD, firstName: 'Sample', lastName: 'Product Manager', role: 'PRODUCT_MANAGER' },
  { email: process.env.SEED_EDITOR_EMAIL, password: process.env.SEED_EDITOR_PASSWORD, firstName: 'Sample', lastName: 'Editor', role: 'EDITOR' }
];
if (seedUsers.some((user) => !user.email || !user.password)) {
  throw new Error('Set a unique development email and password for each seeded role in the SEED_* environment variables');
}
if (seedUsers.some((user) => user.password.length < 12)) {
  throw new Error('Use passwords of at least 12 characters for development seed accounts');
}
if (!process.env.VERIFICATION_HMAC_SECRET || !process.env.SEED_SAMPLE_VERIFICATION_CODE) {
  throw new Error('Set VERIFICATION_HMAC_SECRET and SEED_SAMPLE_VERIFICATION_CODE for the sample item');
}
if (!/^\d{12}$/.test(process.env.SEED_SAMPLE_VERIFICATION_CODE)) {
  throw new Error('SEED_SAMPLE_VERIFICATION_CODE must be exactly 12 digits');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});
try {
  const users = [];
  for (const seedUser of seedUsers) {
    const email = seedUser.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(seedUser.password, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      create: {
        displayId: generateDisplayId('US'),
        email,
        passwordHash,
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        emailVerifiedAt: new Date()
      }
    });
    if (seedUser.platformRole) {
      await prisma.platformMember.upsert({
        where: { userId: user.id },
        update: { role: seedUser.platformRole, status: 'ACTIVE' },
        create: { userId: user.id, role: seedUser.platformRole }
      });
    }
    users.push({ user, role: seedUser.role });
  }
  const company = await prisma.company.upsert({
    where: { slug: 'sample-company' },
    update: {},
    create: { displayId: generateDisplayId('CO'), name: 'Sample Company', slug: 'sample-company' }
  });
  const freePlan = await prisma.plan.upsert({
    where: { name: 'Development Free' },
    update: { isActive: true, price: 0, currency: 'USD', itemLimit: 500, memberLimit: 10, periodDays: 365 },
    create: { name: 'Development Free', price: 0, currency: 'USD', itemLimit: 500, memberLimit: 10, periodDays: 365 }
  });
  const existingSubscription = await prisma.subscription.findFirst({ where: { companyId: company.id, status: { in: ['ACTIVE', 'TRIALING'] } } });
  if (!existingSubscription) {
    await prisma.subscription.create({
      data: {
        companyId: company.id,
        planId: freePlan.id,
        status: 'TRIALING',
        currentPeriodEnd: new Date(Date.now() + freePlan.periodDays * 24 * 60 * 60 * 1000)
      }
    });
  }
  for (const { user, role } of users.filter((entry) => entry.role)) {
    await prisma.companyMember.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: { role, status: 'ACTIVE' },
      create: { userId: user.id, companyId: company.id, role }
    });
  }
  const product = await prisma.product.upsert({
    where: { companyId_slug: { companyId: company.id, slug: 'sample-product' } },
    update: {},
    create: { displayId: generateDisplayId('PI'), companyId: company.id, name: 'Sample Product', slug: 'sample-product', description: 'Local development sample product' }
  });
  const batch = await prisma.batch.upsert({
    where: { productId_batchNumber: { productId: product.id, batchNumber: 'DEMO-001' } },
    update: {},
    create: { displayId: generateDisplayId('BA'), productId: product.id, batchNumber: 'DEMO-001' }
  });
  const sampleItems = await prisma.item.findMany({ where: { batchId: batch.id }, select: { id: true }, take: 2 });
  const verificationCodeHash = createHmac('sha256', process.env.VERIFICATION_HMAC_SECRET)
    .update(process.env.SEED_SAMPLE_VERIFICATION_CODE).digest('hex');
  if (sampleItems.length === 0) {
    const publicToken = randomBytes(32).toString('base64url');
    await prisma.item.create({
      data: { displayId: generateDisplayId('IT'), batchId: batch.id, publicToken, verificationCodeHash, maxSuccessfulUses: 1, overuseAction: 'WARN' }
    });
  } else if (sampleItems.length === 1) {
    await prisma.item.update({ where: { id: sampleItems[0].id }, data: { verificationCodeHash } });
  } else {
    console.warn('Sample code was not changed because the sample batch contains multiple items');
  }
  console.log('Development seed complete for the configured accounts and sample company');
} finally {
  await prisma.$disconnect();
}
