import { prisma } from '../lib/prisma.js';
import { roleHasPermission } from '../config/permissions.js';
import { AppError } from './errorHandler.js';
import { csrfProtection } from './csrfProtection.js';

export async function requireCompanyMembership(req, _res, next) {
  try {
    const requestedCompanyId = req.params.companyId;
    const company = await prisma.company.findFirst({
      where: { OR: [{ id: requestedCompanyId }, { displayId: requestedCompanyId }] },
      select: { id: true }
    });
    if (!company) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    const companyId = company.id;
    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId: req.auth.user.id, status: 'ACTIVE', company: { isActive: true } }
    });
    if (!membership) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    req.companyMembership = membership;
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.companyMembership || !roleHasPermission(req.companyMembership.role, permission)) {
      return next(new AppError(403, 'FORBIDDEN', 'Insufficient permissions'));
    }
    next();
  };
}

export { csrfProtection };
