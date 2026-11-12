import { prisma } from './prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export async function serializableTransaction(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000
      });
    } catch (error) {
      if (error?.code !== 'P2034') throw error;
      if (attempt === 2) {
        throw new AppError(409, 'CONCURRENT_UPDATE', 'Conflicting concurrent operation; retry the request');
      }
    }
  }
  throw new AppError(409, 'CONCURRENT_UPDATE', 'Conflicting concurrent operation; retry the request');
}
