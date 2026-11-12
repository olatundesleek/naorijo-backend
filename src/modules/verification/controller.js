import * as verificationService from './service.js';
import { validate } from '../../lib/validate.js';
import { publicTokenParamsSchema, verificationCodeSchema } from './validation.js';

export async function openPage(req, res, next) {
  try {
    const { publicToken } = validate(publicTokenParamsSchema, req.params);
    const result = await verificationService.openVerificationPage(publicToken, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json(result);
  } catch (error) { next(error); }
}

export async function submitCode(req, res, next) {
  try {
    const { publicToken } = validate(publicTokenParamsSchema, req.params);
    const body = validate(verificationCodeSchema, req.body);
    const result = await verificationService.submitVerification(publicToken, body, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}
