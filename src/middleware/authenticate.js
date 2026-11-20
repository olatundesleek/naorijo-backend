import { env } from '../config/env.js';
import { getAuthenticatedSession } from '../lib/sessionCache.js';
import { hashSessionToken } from '../utils/crypto.js';
import { AppError } from './errorHandler.js';

export async function authenticate(req, _res, next) {
  try {
    const rawToken = req.cookies?.[env.COOKIE_NAME];
    if (!rawToken) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

    const tokenHash = hashSessionToken(rawToken);
    const cachedSession = await getAuthenticatedSession(tokenHash);
    if (!cachedSession) throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    const session = JSON.parse(cachedSession);
    if (typeof session.userId !== 'string' || typeof session.sessionId !== 'string' ||
      typeof session.csrfToken !== 'string' || !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    }

    req.auth = {
      user: { id: session.userId },
      sessionId: session.sessionId,
      tokenHash,
      csrfToken: session.csrfToken
    };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication service is temporarily unavailable'));
  }
}
