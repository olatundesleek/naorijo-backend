import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateDisplayId, generateVerificationCode, hashVerificationCode, randomToken, slugify } from '../../utils/crypto.js';
import { encryptPayload, decryptPayload } from '../../utils/encryptedPayload.js';
import { env } from '../../config/env.js';
import { serializableTransaction } from '../../lib/serializableTransaction.js';

const scopedProductWhere = (companyId, productId) => ({
  companyId,
  OR: [{ id: productId }, { displayId: productId }]
});
const scopedBatchWhere = (companyId, batchId) => ({
  OR: [{ id: batchId }, { displayId: batchId }],
  product: { companyId }
});

export async function listProducts(companyId) {
  return prisma.product.findMany({
    where: { companyId }, orderBy: { createdAt: 'desc' },
    select: { id: true, displayId: true, name: true, slug: true, description: true, isActive: true, createdAt: true, _count: { select: { batches: true } } }
  });
}

export async function createProduct(companyId, actorId, body) {
  const input = body;
  const product = await prisma.product.create({
    data: { displayId: generateDisplayId('PI'), companyId, name: input.name, slug: slugify(input.slug ?? input.name), description: input.description },
    select: { id: true, displayId: true, name: true, slug: true, description: true, isActive: true, createdAt: true }
  });
  await prisma.auditLog.create({ data: { actorId, companyId, action: 'product.created', entityType: 'Product', entityId: product.id } });
  return product;
}

export async function getProduct(companyId, productId) {
  const product = await prisma.product.findFirst({
    where: scopedProductWhere(companyId, productId),
    select: { id: true, displayId: true, name: true, slug: true, description: true, isActive: true, maxSuccessfulUses: true, overuseAction: true, overuseMessage: true, createdAt: true }
  });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return product;
}

export async function updateProduct(companyId, productId, actorId, body) {
  const input = body;
  const existing = await prisma.product.findFirst({ where: scopedProductWhere(companyId, productId) });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const data = { ...input };
  if (input.slug || input.name) data.slug = slugify(input.slug ?? input.name);
  const product = await prisma.product.update({
    where: { id: existing.id }, data,
    select: { id: true, displayId: true, name: true, slug: true, description: true, isActive: true, updatedAt: true }
  });
  await prisma.auditLog.create({ data: { actorId, companyId, action: 'product.updated', entityType: 'Product', entityId: product.id } });
  return product;
}

export async function archiveProduct(companyId, productId, actorId) {
  const product = await prisma.product.findFirst({ where: scopedProductWhere(companyId, productId), select: { id: true } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
  await prisma.auditLog.create({ data: { actorId, companyId, action: 'product.archived', entityType: 'Product', entityId: product.id } });
}

export async function listBatches(companyId, productId) {
  const product = await prisma.product.findFirst({ where: scopedProductWhere(companyId, productId), select: { id: true } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return prisma.batch.findMany({
    where: { productId: product.id }, orderBy: { createdAt: 'desc' },
    select: { id: true, displayId: true, productId: true, batchNumber: true, productionDate: true, expiryDate: true, createdAt: true, _count: { select: { items: true } } }
  });
}

export async function createBatch(companyId, productId, actorId, body) {
  const input = body;
  const product = await prisma.product.findFirst({ where: scopedProductWhere(companyId, productId), select: { id: true } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  if (input.productionDate && input.expiryDate && input.expiryDate < input.productionDate) {
    throw new AppError(400, 'INVALID_DATES', 'Expiry date must not precede production date');
  }

  const batch = await prisma.batch.create({
    data: { displayId: generateDisplayId('BA'), productId: product.id, ...input },
    select: { id: true, displayId: true, productId: true, batchNumber: true, productionDate: true, expiryDate: true, createdAt: true }
  });
  await prisma.auditLog.create({ data: { actorId, companyId, action: 'batch.created', entityType: 'Batch', entityId: batch.id } });
  return batch;
}

export async function getProductVerificationPolicy(companyId, productId) {
  const product = await prisma.product.findFirst({
    where: scopedProductWhere(companyId, productId),
    select: {
      maxSuccessfulUses: true, overuseAction: true, overuseMessage: true,
      company: { select: { defaultMaxSuccessfulUses: true, defaultOveruseAction: true, defaultOveruseMessage: true } }
    }
  });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return {
    maxSuccessfulUses: product.maxSuccessfulUses,
    overuseAction: product.overuseAction,
    overuseMessage: product.overuseMessage,
    effective: {
      maxSuccessfulUses: product.maxSuccessfulUses ?? product.company.defaultMaxSuccessfulUses,
      overuseAction: product.overuseAction ?? product.company.defaultOveruseAction,
      overuseMessage: product.overuseMessage ?? product.company.defaultOveruseMessage
    }
  };
}

export async function updateProductVerificationPolicy(companyId, productId, actorId, body) {
  const input = body;
  const existing = await prisma.product.findFirst({ where: scopedProductWhere(companyId, productId), select: { id: true } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: existing.id }, data: input,
      select: { id: true, displayId: true, maxSuccessfulUses: true, overuseAction: true, overuseMessage: true }
    });
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'verification_policy.product_updated', entityType: 'Product', entityId: productId, metadata: input }
    });
    return updated;
  });
}

export async function updateBatch(companyId, batchId, actorId, body) {
  const input = body;
  const existing = await prisma.batch.findFirst({ where: scopedBatchWhere(companyId, batchId) });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const productionDate = input.productionDate ?? existing.productionDate;
  const expiryDate = input.expiryDate ?? existing.expiryDate;
  if (productionDate && expiryDate && expiryDate < productionDate) {
    throw new AppError(400, 'INVALID_DATES', 'Expiry date must not precede production date');
  }
  const batch = await prisma.batch.update({
    where: { id: existing.id }, data: input,
    select: { id: true, displayId: true, productId: true, batchNumber: true, productionDate: true, expiryDate: true, updatedAt: true }
  });
  await prisma.auditLog.create({ data: { actorId, companyId, action: 'batch.updated', entityType: 'Batch', entityId: batch.id } });
  return batch;
}

export async function getBatch(companyId, batchId) {
  const batch = await prisma.batch.findFirst({
    where: scopedBatchWhere(companyId, batchId),
    select: { id: true, displayId: true, productId: true, batchNumber: true, productionDate: true, expiryDate: true, createdAt: true }
  });
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  return batch;
}

export async function generateItems(companyId, batchId, actorId, body, idempotencyKey) {
  const { count } = body;
  const batch = await prisma.batch.findFirst({
    where: scopedBatchWhere(companyId, batchId),
    include: { product: { include: { company: { select: { defaultMaxSuccessfulUses: true, defaultOveruseAction: true, defaultOveruseMessage: true } } } } }
  });
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const requestHash = createHash('sha256').update(JSON.stringify({ batchId: batch.id, count })).digest('hex');
  const itemCodes = Array.from({ length: count }, () => ({ publicToken: randomToken(), code: generateVerificationCode() }));

  try {
    const items = await serializableTransaction(async (tx) => {
      const idempotency = await tx.idempotencyKey.create({ data: { companyId, key: idempotencyKey, requestHash } });
      const existingCount = await tx.item.count({ where: { batch: { product: { companyId } } } });
      const subscription = await tx.subscription.findFirst({
        where: {
          companyId,
          status: { in: ['ACTIVE', 'TRIALING'] },
          OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
          plan: { isActive: true }
        },
        orderBy: { createdAt: 'desc' }, include: { plan: true }
      });
      if (!subscription) throw new AppError(403, 'SUBSCRIPTION_REQUIRED', 'An active subscription is required for item generation');
      if (subscription && existingCount + count > subscription.plan.itemLimit) {
        throw new AppError(403, 'QUOTA_EXCEEDED', 'Item generation would exceed the current plan limit');
      }
      const created = [];
      for (const item of itemCodes) {
        created.push(await tx.item.create({
          data: {
            displayId: generateDisplayId('IT'),
            batchId: batch.id,
            publicToken: item.publicToken,
            verificationCodeHash: hashVerificationCode(item.code),
            maxSuccessfulUses: batch.product.maxSuccessfulUses ?? batch.product.company.defaultMaxSuccessfulUses,
            overuseAction: batch.product.overuseAction ?? batch.product.company.defaultOveruseAction,
            overuseMessage: batch.product.overuseMessage ?? batch.product.company.defaultOveruseMessage
          },
          select: { id: true, displayId: true, publicToken: true }
        }));
      }
      await tx.auditLog.create({ data: { actorId, companyId, action: 'items.generated', entityType: 'Batch', entityId: batch.id, metadata: { count } } });
      const exportData = created.map((item, index) => ({
        id: item.id,
        displayId: item.displayId,
        publicToken: item.publicToken,
        verificationUrl: `${env.PUBLIC_VERIFICATION_BASE_URL}/${encodeURIComponent(item.publicToken)}`,
        verificationCode: itemCodes[index].code
      }));
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const exportJob = await tx.printExportJob.create({
        data: {
          companyId, createdById: actorId, ...encryptPayload(exportData), expiresAt
        },
        select: { id: true, expiresAt: true }
      });
      await tx.idempotencyKey.update({ where: { id: idempotency.id }, data: { exportJobId: exportJob.id } });
      return { exportJob, itemCount: created.length };
    });
    return {
      generatedCount: items.itemCount,
      printExport: items.exportJob,
      message: 'Verification codes are encrypted and available once through the authorized print-export endpoint.'
    };
  } catch (error) {
    if (error?.code === 'P2002') {
      const prior = await prisma.idempotencyKey.findUnique({ where: { companyId_key: { companyId, key: idempotencyKey } } });
      if (prior) {
        if (prior.requestHash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request');
        }
        return {
          generatedCount: count,
          printExport: prior.exportJobId ? await prisma.printExportJob.findUnique({ where: { id: prior.exportJobId }, select: { id: true, expiresAt: true } }) : null,
          message: 'This request was already processed. The export remains available only through its authorized one-time download.'
        };
      }

    }
    throw error;
  }
}

export async function downloadPrintExport(companyId, exportJobId, actorId) {
  const job = await prisma.printExportJob.findFirst({
    where: { id: exportJobId, companyId, downloadedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, payloadCiphertext: true, payloadNonce: true, payloadTag: true }
  });
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Print export was not found, has expired, or has already been downloaded');
  const content = decryptPayload(job);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.printExportJob.updateMany({
      where: { id: job.id, companyId, downloadedAt: null, expiresAt: { gt: new Date() } },
      data: { downloadedAt: new Date(), payloadCiphertext: '', payloadNonce: '', payloadTag: '' }
    });
    if (consumed.count !== 1) throw new AppError(404, 'NOT_FOUND', 'Print export was not found, has expired, or has already been downloaded');
    await tx.auditLog.create({
      data: { actorId, companyId, action: 'codes.exported', entityType: 'PrintExportJob', entityId: job.id, metadata: { itemCount: content.length } }
    });
  });
  return content;
}

export async function listPrintExports(companyId) {
  return prisma.printExportJob.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, expiresAt: true, downloadedAt: true }
  });
}

export async function listItems(companyId, batchId, { page, pageSize }) {
  const batch = await prisma.batch.findFirst({ where: scopedBatchWhere(companyId, batchId), select: { id: true } });
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const items = await prisma.item.findMany({
    where: { batchId: batch.id },
    skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' },
    select: { id: true, displayId: true, publicToken: true, status: true, successfulUses: true, maxSuccessfulUses: true, overuseAction: true, createdAt: true }
  });
  return { items, page, pageSize };
}

export async function changeItemStatus(companyId, itemId, actorId, status) {
  const item = await prisma.item.findFirst({
    where: {
      OR: [{ id: itemId }, { displayId: itemId }],
      batch: { product: { companyId } }
    }
  });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  const updated = await prisma.item.update({ where: { id: item.id }, data: { status }, select: { id: true, displayId: true, status: true } });
  await prisma.auditLog.create({
    data: { actorId, companyId, action: status === 'REVOKED' ? 'item.revoked' : 'item.recalled', entityType: 'Item', entityId: item.id }
  });
  return updated;
}
