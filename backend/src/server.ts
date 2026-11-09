import { buildApp } from './app.js';
import { getConfig, resolveDatabasePath } from './config.js';
import { openDatabase } from './db/index.js';

const env = getConfig();
const db = openDatabase(resolveDatabasePath(env));
const app = await buildApp({ env, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: env.HOST });
