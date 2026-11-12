import { AppError } from '../middleware/errorHandler.js';

export function validate(schema, value) {
  const { error, value: validated } = schema.validate(value, {
    abortEarly: false,
    convert: true,
    stripUnknown: false
  });
  if (error) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      error.details.map(({ message, path, type }) => ({ message, path, type }))
    );
  }
  return validated;
}
