export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A resource with these details already exists' } });
  }
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof AppError ? error.message : 'An unexpected error occurred';
  if (status === 500) console.error(error);
  return res.status(status).json({
    error: {
      code,
      message,
      ...(error instanceof AppError && error.details ? { details: error.details } : {})
    }
  });
}
