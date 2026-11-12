import { prisma } from '../lib/prisma.js';

export async function expirePrintExportPayloads() {
  const result = await prisma.printExportJob.updateMany({
    where: { expiresAt: { lte: new Date() }, payloadCiphertext: { not: '' } },
    data: { payloadCiphertext: '', payloadNonce: '', payloadTag: '' }
  });
  return result.count;
}
