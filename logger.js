import { dirname, join } from "path";
import pino from "pino";
import { fileURLToPath } from "url";

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const __dirname = dirname(fileURLToPath(import.meta.url));
const loggerConfPath = join(__dirname, "logger.conf.js");

async function reloadLoggerConf (signal, supressOutput) {
  logger.info(`reload: ${signal}: logger.level: ${logger.level}`);
  try {
    const conf = await import(loggerConfPath.concat(
      `?${Math.random().toString(32).slice(6)}`
    )).then(data => data.default);

    logger.info(`reload: ${signal}: ${loggerConfPath}: ${JSON.stringify(conf)}`);
    logger.level = conf?.level || "info";
    logger.info(`reload: ${signal}: changed logger.level to ${logger.level}`);
  } catch (err) {
    !supressOutput && logger.error(err, `reload: ${signal}: import failed`);
  }
}

// process.on('SIGBREAK', () => reloadLoggerConf('SIGBREAK'));
process.on('SIGHUP', () => reloadLoggerConf('SIGHUP'));
setImmediate(() => reloadLoggerConf("on start-up", true));

export default logger;