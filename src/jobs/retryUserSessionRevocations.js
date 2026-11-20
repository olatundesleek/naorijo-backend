import { prisma } from '../lib/prisma.js';
import { revokeUserSessionsInRedis } from '../lib/sessionCache.js';

const RETRY_DELAYS_MS = [100, 250, 500];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function processUserSessionRevocation(event) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: event.userId },
        select: { status: true }
      });
      const authState = user?.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
      await revokeUserSessionsInRedis(event.userId, authState, event.blockOperationId);
      await prisma.userSessionRevocationOutbox.update({
        where: { id: event.id },
        data: { processedAt: new Date(), lastError: null }
      });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < RETRY_DELAYS_MS.length) await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  await prisma.userSessionRevocationOutbox.update({
    where: { id: event.id },
    data: {
      attempts: { increment: RETRY_DELAYS_MS.length },
      nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1000 * (2 ** Math.min(event.attempts ?? 0, 6)))),
      lastError: String(lastError?.message ?? 'Redis revocation failed').slice(0, 500)
    }
  });
  return false;
}

export async function retryPendingUserSessionRevocations() {
  const events = await prisma.userSessionRevocationOutbox.findMany({
    where: { processedAt: null, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: 50
  });
  for (const event of events) {
    await processUserSessionRevocation(event);
  }
}
