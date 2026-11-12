import { prisma } from '../lib/prisma.js';
import { platformRoleHasPermission } from '../config/permissions.js';
import { AppError } from './errorHandler.js';

export function requirePlatformAccess(permission) {
  return async (req, _res, next) => {
    try {
      const membership = await prisma.platformMember.findFirst({
        where: { userId: req.auth.user.id, status: 'ACTIVE' }
      });
      if (!membership) throw new AppError(403, 'FORBIDDEN', 'Platform access required');
      if (!platformRoleHasPermission(membership.role, permission)) {
        throw new AppError(403, 'FORBIDDEN', 'Insufficient platform permissions');
      }
      req.platformMembership = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}
