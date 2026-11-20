import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection, requireCompanyMembership, requirePermission } from '../../middleware/companyAccess.js';
import { uploadProductImage } from '../../middleware/productImageUpload.js';
import { redisRateLimit } from '../../middleware/rateLimiters.js';
import * as controller from './controller.js';

const router = Router();
const generationLimiter = redisRateLimit({ prefix: 'rate:item-generation', limit: 20, windowSeconds: 3600 });
const exportLimiter = redisRateLimit({ prefix: 'rate:print-export', limit: 5, windowSeconds: 3600 });

router.use('/companies/:companyId', authenticate, requireCompanyMembership, csrfProtection);
router.get('/companies/:companyId/products', requirePermission('products:read'), controller.listProducts);
router.post('/companies/:companyId/products', requirePermission('products:create'), controller.createProduct);
router.get('/companies/:companyId/products/:productId', requirePermission('products:read'), controller.getProduct);
router.patch('/companies/:companyId/products/:productId', requirePermission('products:update'), controller.updateProduct);
router.post('/companies/:companyId/products/:productId/image', requirePermission('products:update'), uploadProductImage, controller.uploadProductImage);
router.get('/companies/:companyId/products/:productId/verification-policy', requirePermission('products:read'), controller.getProductVerificationPolicy);
router.patch('/companies/:companyId/products/:productId/verification-policy', requirePermission('verification-policy:manage'), controller.updateProductVerificationPolicy);
router.post('/companies/:companyId/products/:productId/archive', requirePermission('products:archive'), controller.archiveProduct);
router.get('/companies/:companyId/products/:productId/batches', requirePermission('batches:read'), controller.listBatches);
router.post('/companies/:companyId/products/:productId/batches', requirePermission('batches:create'), controller.createBatch);
router.patch('/companies/:companyId/batches/:batchId', requirePermission('batches:update'), controller.updateBatch);
router.get('/companies/:companyId/batches/:batchId', requirePermission('batches:read'), controller.getBatch);
router.post('/companies/:companyId/batches/:batchId/items/generate', requirePermission('items:generate'), generationLimiter, controller.generateItems);
router.get('/companies/:companyId/batches/:batchId/items', requirePermission('items:read'), controller.listItems);
router.get('/companies/:companyId/print-exports', requirePermission('codes:export'), controller.listPrintExports);
router.post('/companies/:companyId/print-exports/:exportJobId/download', requirePermission('codes:export'), exportLimiter, controller.downloadPrintExport);
router.post('/companies/:companyId/items/:itemId/revoke', requirePermission('items:revoke'), controller.revokeItem);
router.post('/companies/:companyId/items/:itemId/recall', requirePermission('items:revoke'), controller.recallItem);

export default router;
