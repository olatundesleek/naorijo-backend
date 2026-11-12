import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { hashSessionToken } from '../utils/crypto.js';
import { AppError } from './errorHandler.js';

export async function authenticate(req, _res, next) {
  try {
    const rawToken = req.cookies[env.COOKIE_NAME];
    if (!rawToken) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

    const tokenHash = hashSessionToken(rawToken);
    const cachedSession = await redis.get(`session:${tokenHash}`);
    if (!cachedSession) throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    const session = JSON.parse(cachedSession);
    const now = Date.now();
    if (session.expiresAt <= now) {
      await redis.del(`session:${tokenHash}`);
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    }

    const persisted = await prisma.loginSession.findFirst({
      where: { tokenHash, userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, expiresAt: true, lastSeenAt: true }
    });
    if (!persisted) {
      await redis.del(`session:${tokenHash}`);
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    }
    if (persisted.lastSeenAt && persisted.lastSeenAt.getTime() < now - 5 * 60 * 1000) {
      await prisma.loginSession.updateMany({
        where: { id: persisted.id, lastSeenAt: { lt: new Date(now - 5 * 60 * 1000) } },
        data: { lastSeenAt: new Date(now) }
      });
    }
    const user = await prisma.user.findFirst({
      where: { id: persisted.userId, status: 'ACTIVE' },
      select: { id: true, displayId: true, email: true, firstName: true, middleName: true, lastName: true }
    });
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account is unavailable');

    req.auth = { user, sessionId: persisted.id, tokenHash, csrfToken: session.csrfToken };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication service is temporarily unavailable'));
  }
}
