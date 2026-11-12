import { AppError } from './errorHandler.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, _res, next) {
  if (safeMethods.has(req.method)) return next();
  const supplied = req.get('x-csrf-token');
  if (!supplied || supplied !== req.auth?.csrfToken) {
    return next(new AppError(403, 'CSRF_FAILED', 'CSRF token is missing or invalid'));
  }
  next();
}
