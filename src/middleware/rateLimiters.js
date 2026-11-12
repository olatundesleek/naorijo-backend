import { AppError } from './errorHandler.js';
import { redis } from '../lib/redis.js';

export function redisRateLimit({ prefix, limit, windowSeconds }) {
  return async (req, _res, next) => {
    try {
      const key = `${prefix}:${req.ip}`;
      const count = Number(await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
        { keys: [key], arguments: [String(windowSeconds)] }
      ));
      if (count > limit) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts; try again later');
      next();
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Request protection is temporarily unavailable'));
    }
  };
}

export const loginLimiter = redisRateLimit({ prefix: 'rate:login', limit: 10, windowSeconds: 900 });
export const verificationLimiter = redisRateLimit({ prefix: 'rate:verify', limit: 20, windowSeconds: 900 });
