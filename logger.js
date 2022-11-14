import { randomUUID } from "crypto";
import { dirname, join } from "path";
import pino from "pino";
import { fileURLToPath, pathToFileURL } from "url";
import { AsyncLocalStorage } from 'async_hooks'
const asyncContext = new AsyncLocalStorage();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const __dirname = dirname(fileURLToPath(import.meta.url));
const loggerConfPath = join(__dirname, "logger.conf.js");
const loggerConfUrl = pathToFileURL(loggerConfPath);

async function reloadLoggerConf (signal, supressOutput) {
  try {
    loggerConfUrl.searchParams.set("ver", Math.random().toString(32).slice(6));
    const conf = await import(loggerConfUrl).then(data => data.default);

    logger.info(`reload: ${signal}: loaded: ${loggerConfPath}: ${JSON.stringify(conf)}`);
    logger.level = conf?.level || "info";
    logger.info(`reload: ${signal}: changed logger.level to ${logger.level}`);
    return;
  } catch (err) {
     logger.error(err, `reload: ${signal}: import failed`);
  }
  logger.info(`reload: ${signal}: logger.level: ${logger.level}`);
}

// process.on('SIGBREAK', () => reloadLoggerConf('SIGBREAK'));
process.on('SIGHUP', () => reloadLoggerConf('SIGHUP'));
setImmediate(() => reloadLoggerConf("on start-up", true));

export default new Proxy(logger, {
  get(target, property, receiver) {
    target = asyncContext.getStore()?.get('logger') || target;
    return Reflect.get(target, property, receiver);
  },
});

export const loggerMiddleware = (ctx, next) => {
  const child = logger.child({ requestId: randomUUID() });
  const store = new Map();
  store.set('logger', child);

  return asyncContext.run(store, next);
}