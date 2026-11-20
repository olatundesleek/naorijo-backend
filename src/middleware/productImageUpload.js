import multer from 'multer';
import { AppError } from './errorHandler.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
}).single('image');

export function uploadProductImage(req, res, next) {
  upload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return next(new AppError(status, 'INVALID_PRODUCT_IMAGE', 'Provide one image file no larger than 5 MB'));
    }
    if (error) return next(error);
    next();
  });
}
