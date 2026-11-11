import { buildApp } from './app.js';
import { getConfig, missingFor, resolveDatabasePath } from './config.js';
import { openDatabase } from './db/index.js';
import { startPriceWatch } from './pricing/job.js';

const env = getConfig();
const db = openDatabase(resolveDatabasePath(env));
const app = await buildApp({ env, db });

const stopWatch =
  env.PRICE_WATCH_INTERVAL_MINUTES > 0 && missingFor(env, 'channel3').length === 0
    ? startPriceWatch(app, env.PRICE_WATCH_INTERVAL_MINUTES)
    : undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  stopWatch?.();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: env.HOST });
