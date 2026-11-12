import { describe, expect, it } from 'vitest';
import Joi from 'joi';
import { validate } from '../../src/lib/validate.js';
import { AppError } from '../../src/middleware/errorHandler.js';
import { generateItemsSchema, listItemsQuerySchema } from '../../src/modules/products/validation.js';
import { verificationCodeSchema } from '../../src/modules/verification/validation.js';
import { createUserSchema } from '../../src/modules/auth/validation.js';

describe('Joi request validation', () => {
  it('coerces and defaults query values before services receive them', () => {
    expect(validate(listItemsQuerySchema, { page: '2' })).toEqual({ page: 2, pageSize: 25 });
  });

  it('rejects unknown request fields with a structured client error', () => {
    try {
      validate(generateItemsSchema, { count: 2, extra: true });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'object.unknown' })
      ]));
    }
  });

  it('accepts 12-digit product verification codes and rejects malformed codes', () => {
    expect(validate(verificationCodeSchema, { code: '001234567890' }).code).toBe('001234567890');
    expect(() => validate(verificationCodeSchema, { code: '12345678901' })).toThrow(AppError);
  });

  it('requires first and last names while allowing an optional middle name', () => {
    const user = {
      email: 'user@example.com',
      password: 'strong password 123',
      firstName: 'Alex',
      lastName: 'Smith',
      role: 'EDITOR'
    };
    expect(validate(createUserSchema, user)).toEqual(user);
    expect(validate(createUserSchema, { ...user, middleName: 'Morgan' }).middleName).toBe('Morgan');
    expect(() => validate(createUserSchema, { ...user, firstName: undefined })).toThrow(AppError);
    expect(() => validate(createUserSchema, { ...user, lastName: undefined })).toThrow(AppError);
  });

  it('rejects unsupported keys instead of silently stripping them', () => {
    const schema = Joi.object({ value: Joi.number().required() }).required();
    expect(() => validate(schema, { value: 1, ignored: true })).toThrow(AppError);
  });
});
