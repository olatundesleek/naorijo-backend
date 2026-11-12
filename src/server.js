import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { connectRedis, redis } from './lib/redis.js';
import { expirePrintExportPayloads } from './jobs/expirePrintExports.js';
import { expireSubscriptions } from './jobs/expireSubscriptions.js';

await connectRedis();
await prisma.$connect();
await Promise.all([expirePrintExportPayloads(), expireSubscriptions()]);
const server = app.listen(env.PORT, () => {
  console.log(`Product verification API listening on port ${env.PORT}`);
});
const exportCleanupInterval = setInterval(() => {
  Promise.all([expirePrintExportPayloads(), expireSubscriptions()]).catch((error) => {
    console.error('Scheduled expiry cleanup failed:', error.message);
  });
}, 60 * 60 * 1000);
exportCleanupInterval.unref();

async function shutdown() {
  clearInterval(exportCleanupInterval);
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
