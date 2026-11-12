import * as productService from './service.js';
import { validate } from '../../lib/validate.js';
import {
  batchCreateSchema,
  batchUpdateSchema,
  companyParamsSchema,
  generateItemsSchema,
  idempotencyKeySchema,
  listItemsQuerySchema,
  productCreateSchema,
  productPolicySchema,
  productUpdateSchema
} from './validation.js';

export async function listProducts(req, res, next) {
  try { res.json({ products: await productService.listProducts(req.companyMembership.companyId) }); }
  catch (error) { next(error); }
}
export async function createProduct(req, res, next) {
  try {
    const product = await productService.createProduct(req.companyMembership.companyId, req.auth.user.id, validate(productCreateSchema, req.body));
    res.status(201).json({ product });
  } catch (error) { next(error); }
}
export async function getProduct(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    res.json({ product: await productService.getProduct(req.companyMembership.companyId, productId) });
  }
  catch (error) { next(error); }
}
export async function updateProduct(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    const product = await productService.updateProduct(req.companyMembership.companyId, productId, req.auth.user.id, validate(productUpdateSchema, req.body));
    res.json({ product });
  } catch (error) { next(error); }
}
export async function getProductVerificationPolicy(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    const policy = await productService.getProductVerificationPolicy(req.companyMembership.companyId, productId);
    res.json({ policy });
  } catch (error) { next(error); }
}
export async function updateProductVerificationPolicy(req, res, next) {
  try {
    const policy = await productService.updateProductVerificationPolicy(
      req.companyMembership.companyId,
      validate(companyParamsSchema, req.params).productId,
      req.auth.user.id,
      validate(productPolicySchema, req.body)
    );
    res.json({ policy });
  } catch (error) { next(error); }
}
export async function archiveProduct(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    await productService.archiveProduct(req.companyMembership.companyId, productId, req.auth.user.id);
    res.status(204).end();
  } catch (error) { next(error); }
}
export async function listBatches(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    const batches = await productService.listBatches(req.companyMembership.companyId, productId);
    res.json({ batches });
  } catch (error) { next(error); }
}
export async function createBatch(req, res, next) {
  try {
    const { productId } = validate(companyParamsSchema, req.params);
    const batch = await productService.createBatch(req.companyMembership.companyId, productId, req.auth.user.id, validate(batchCreateSchema, req.body));
    res.status(201).json({ batch });
  } catch (error) { next(error); }
}
export async function updateBatch(req, res, next) {
  try {
    const { batchId } = validate(companyParamsSchema, req.params);
    const batch = await productService.updateBatch(req.companyMembership.companyId, batchId, req.auth.user.id, validate(batchUpdateSchema, req.body));
    res.json({ batch });
  } catch (error) { next(error); }
}
export async function getBatch(req, res, next) {
  try {
    const { batchId } = validate(companyParamsSchema, req.params);
    res.json({ batch: await productService.getBatch(req.companyMembership.companyId, batchId) });
  }
  catch (error) { next(error); }
}
export async function generateItems(req, res, next) {
  try {
    const { batchId } = validate(companyParamsSchema, req.params);
    const body = validate(generateItemsSchema, req.body);
    const idempotencyKey = validate(idempotencyKeySchema, req.get('idempotency-key'));
    const result = await productService.generateItems(req.companyMembership.companyId, batchId, req.auth.user.id, body, idempotencyKey);
    res.status(201).json(result);
  } catch (error) { next(error); }
}
export async function listItems(req, res, next) {
  try {
    const { batchId } = validate(companyParamsSchema, req.params);
    const query = validate(listItemsQuerySchema, req.query);
    res.json(await productService.listItems(req.companyMembership.companyId, batchId, query));
  }
  catch (error) { next(error); }
}
export async function revokeItem(req, res, next) {
  try {
    const { itemId } = validate(companyParamsSchema, req.params);
    const item = await productService.changeItemStatus(req.companyMembership.companyId, itemId, req.auth.user.id, 'REVOKED');
    res.json({ item });
  } catch (error) { next(error); }
}
export async function recallItem(req, res, next) {
  try {
    const { itemId } = validate(companyParamsSchema, req.params);
    const item = await productService.changeItemStatus(req.companyMembership.companyId, itemId, req.auth.user.id, 'RECALLED');
    res.json({ item });
  } catch (error) { next(error); }
}
export async function downloadPrintExport(req, res, next) {
  try {
    const { exportJobId } = validate(companyParamsSchema, req.params);
    const items = await productService.downloadPrintExport(
      req.companyMembership.companyId, exportJobId, req.auth.user.id
    );
    res.set({
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      'Content-Disposition': 'attachment; filename="product-codes.json"',
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.status(200).send(JSON.stringify({ items }));
  } catch (error) { next(error); }
}
export async function listPrintExports(req, res, next) {
  try {
    res.json({ exports: await productService.listPrintExports(req.companyMembership.companyId) });
  } catch (error) { next(error); }
}
