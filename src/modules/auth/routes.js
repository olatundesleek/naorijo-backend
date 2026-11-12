import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';
import { requirePlatformAccess } from '../../middleware/platformAccess.js';
import { loginLimiter } from '../../middleware/rateLimiters.js';
import { redisRateLimit } from '../../middleware/rateLimiters.js';
import * as controller from './controller.js';

const router = Router();
const recoveryLimiter = redisRateLimit({ prefix: 'rate:recovery', limit: 5, windowSeconds: 3600 });

router.post('/register-company', authenticate, requirePlatformAccess('companies:manage'), csrfProtection, controller.registerCompany);
router.post('/login', loginLimiter, controller.login);
router.get('/me', authenticate, controller.me);
router.post('/logout', authenticate, csrfProtection, controller.logout);
router.post('/logout-all', authenticate, csrfProtection, controller.logoutAll);
router.post('/verify-email', recoveryLimiter, controller.verifyEmail);
router.post('/resend-verification', recoveryLimiter, controller.resendVerification);
router.post('/forgot-password', recoveryLimiter, controller.forgotPassword);
router.post('/reset-password', recoveryLimiter, controller.resetPassword);

export default router;
