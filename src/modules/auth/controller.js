import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { validate } from '../../lib/validate.js';
import * as authService from './service.js';
import {
  emailSchema,
  loginSchema,
  registerCompanySchema,
  resetSchema,
  verifySchema
} from './validation.js';

const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
};

export async function registerCompany(req, res, next) {
  try {
    res.status(201).json(await authService.registerCompany(req.auth.user.id, validate(registerCompanySchema, req.body)));
  } catch (error) { next(error); }
}

export async function login(req, res, next) {
  try {
    const result = await authService.login(validate(loginSchema, req.body), {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.cookie(env.COOKIE_NAME, result.token, { ...cookieOptions, maxAge: env.SESSION_TTL_SECONDS * 1000 });
    res.json(result.body);
  } catch (error) {
    if (!(error instanceof AppError)) {
      return next(new AppError(503, 'LOGIN_UNAVAILABLE', 'Login service is temporarily unavailable'));
    }
    next(error);
  }
}

export async function me(req, res, next) {
  try {
    const current = await authService.getCurrentUser(req.auth.user.id, req.auth.tokenHash);
    res.json({ user: req.auth.user, ...current });
  } catch (error) { next(error); }
}

export async function logout(req, res, next) {
  try {
    await authService.logout({ sessionId: req.auth.sessionId, userId: req.auth.user.id, tokenHash: req.auth.tokenHash });
    res.clearCookie(env.COOKIE_NAME, cookieOptions);
    res.status(204).end();
  } catch {
    next(new AppError(503, 'LOGOUT_UNAVAILABLE', 'Could not revoke session; retry logout'));
  }
}

export async function logoutAll(req, res, next) {
  try {
    await authService.logoutAll(req.auth.user.id);
    res.clearCookie(env.COOKIE_NAME, cookieOptions);
    res.status(204).end();
  } catch {
    next(new AppError(503, 'LOGOUT_UNAVAILABLE', 'Could not revoke sessions; retry logout'));
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const { token } = validate(verifySchema, req.body);
    res.json(await authService.verifyEmail(token));
  } catch (error) { next(error); }
}

export async function resendVerification(req, res, next) {
  try {
    const { email } = validate(emailSchema, req.body);
    res.status(202).json(await authService.resendEmailVerification(email));
  } catch (error) { next(error); }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = validate(emailSchema, req.body);
    await authService.requestPasswordReset(email);
    res.status(202).json({ accepted: true, message: 'If the account is eligible, password reset instructions will be sent.' });
  } catch (error) { next(error); }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, password } = validate(resetSchema, req.body);
    res.json(await authService.resetPassword(token, password));
  } catch (error) { next(error); }
}
