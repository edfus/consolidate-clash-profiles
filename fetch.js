import { request } from "http2-wrapper";
import { request as requestHTTP } from "http";
import { promises as fsp } from 'fs';
import { createHash } from 'crypto';
import { pipeline, Transform, Writable } from "stream";
import sanitize from "sanitize-filename";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parse as parseCacheControl } from "@tusbar/cache-control";
import { freemem } from "os";
import logger from "./logger.js";

class StringReader extends Transform {
  constructor(maxLength = Infinity) {
    super({ readableObjectMode: true });
    this[Symbol.for("kLength")] = 0;
    this[Symbol.for("kMaxLength")] = maxLength;
    this[Symbol.for("kTmpSource")] = [];
  }

  _transform(chunk, enc, cb) {
    this[Symbol.for("kTmpSource")].push(chunk);
    if (this[Symbol.for("kLength")] += chunk.length > this[Symbol.for("kMaxLength")])
      return cb(new RangeError(`${this.constructor.name}: maxLength ${maxLength} reached.`));
    return cb();
  }

  _flush(cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    );

    return cb(null, data);
  }
}

function sha1(str) {
  if (typeof str !== "string") {
    return "";
  }

  return createHash('sha1').update(str).digest('hex');
}


const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheFolder = join(__dirname, "cached");
const cacheStore = new Map();
let cacheMemoryFootprint = 0;

async function readCache(url) {
  const filename = sanitize(url);
  logger.debug(`fetch: cache: ${url}: read: filesystem: ${filename}`);
  return fsp.readFile(
    join(cacheFolder, filename), "utf-8"
  ).catch(err => logger.error(err, `cache: ${url}: read: errored`));
}

async function writeCache(url, payload) {
  logger.debug(`fetch: cache: ${url}: filesystem: storing`);
  const filename = sanitize(url);
  logger.debug(`fetch: cache: ${url}: filesystem: storing to ${filename}`);
  try {
    await fsp.writeFile(join(cacheFolder, filename), payload, "utf-8");
    logger.debug(`fetch: cache: ${url}: filesystem: finished writing to ${filename}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        await fsp.mkdir(cacheFolder, { recursive: true });
        await fsp.writeFile(
          join(cacheFolder, filename), payload, "utf-8"
        );
        logger.debug(`fetch: cache: ${url}: filesystem: finished writing to ${filename}`);
      } catch (err) {
        logger.error(err, `cache: ${url}: filesystem: ENOENT & mkdir failed`);
      }
    } else {
      logger.error(err, `cache: ${url}: filesystem: unexpected error`);
    }
  }
}

async function checkCache(url) {
  const cache = cacheStore.get(url);

  if (!cache) {
    logger.debug(`fetch: cache: ${url}: check: missed`);
    return null;
  }

  const timeElapsed = Date.now() - cache.timestamp;
  if (timeElapsed >= cache.maxAge) {
    logger.debug(`fetch: cache: ${url}: check: timeElapsed >= cache.maxAge: ${timeElapsed} >= ${cache.maxAge}`);
    return null;
  }

  if (timeElapsed >= cache.minFresh) {
    logger.debug(`fetch: cache: ${url}: check: timeElapsed >= cache.minFresh: ${timeElapsed} >= ${cache.minFresh}`);
    scheduleRefresh(url);
  }

  cache.lastAccess = Date.now();

  if (cache.content) {
    logger.debug(`fetch: cache: ${url}: check: in memory: hit`);
    return {
      url,
      headers: cache.headers,
      payload: cache.content,
      hash: cache.hash
    };
  }

  const fileContent = await readCache(url);

  if (sha1(fileContent) !== cache.hash) {
    logger.debug(`fetch: cache: ${url}: check: filesytem: hashes mismatch`);
    // await fsp.rm(join(cacheFolder, filename), { force: true })
    cacheStore.delete(url);
    return null;
  }

  logger.debug(`fetch: cache: ${url}: check: filesytem: hit`);
  cache.content = fileContent;
  cacheMemoryFootprint += cache.content?.length || 0;
  logger.debug(`fetch: cache: global: in-memory: footprint: ${cacheMemoryFootprint}`);
  return {
    url,
    headers: cache.headers,
    payload: cache.content,
    hash: cache.hash
  };
}

const schedules = new Set();
function scheduleRefresh(url) {
  if (schedules.has(url)) {
    logger.debug(`fetch: cache: ${url}: scheduleRefresh: schedules.has(url)`);
    return;
  }

  logger.debug(`fetch: cache: ${url}: refreshing`);
  schedules.add(url);
  logger.debug(`fetch: cache: ${url}: scheduleRefresh: schedules.add(url)`);
  fetch(url).then(cache).catch(err => logger.error(err, `fetch: cache: ${url}: scheduleRefresh: fetch(url).then(cache) failed`)).finally(() => {
    schedules.delete(url);
    logger.debug(`fetch: cache: ${url}: scheduleRefresh: fetch(url).then(cache).finally: schedules.delete(url)`);
  });
}

function pruneCacheStore() {
  let cacheStoreEmpty = true;
  for (const [url, cache] of cacheStore.entries()) {
    if (cache.content) {
      const timeElapsed = Date.now() - cache.lastAccess;
      if (
        freemem() < cacheMemoryFootprint * 2 * 8 // UTF-16
        || timeElapsed > 1000 * 600) { // 10 minutes
        cacheMemoryFootprint -= cache.content.length;
        cache.content = null;
        logger.debug(`fetch: cache: ${url}: in memory cache offloaded`);
        logger.debug(`fetch: cache: global: in-memory: footprint: ${cacheMemoryFootprint}`);
      } else {
        cacheStoreEmpty = false;
      }
    }
  }

  if (cacheStoreEmpty) {
    cacheMemoryFootprint = 0;
    logger.debug(`fetch: cacheStoreEmpty: cache memory footprint: ${cacheMemoryFootprint}`);
  }
}

setInterval(pruneCacheStore, 3000).unref();

function cache({ headers, payload, url }) {
  const cacheControl = parseCacheControl(headers["cache-control"]);
  const cache = {
    etag: headers["etag"], // ignored for now
    maxAge: (cacheControl.maxAge || 3600_3) * 1000,
    minFresh: (cacheControl.minFresh || 20) * 1000,
    content: payload,
    headers: headers, // http.maxHeaderSize
    lastAccess: Date.now(),
    timestamp: Date.now(),
    hash: sha1(payload)
  };

  cacheStore.set(url, cache);
  logger.debug(`fetch: cache: ${url}: in-memory: stored: ${cache.hash}`);
  cacheMemoryFootprint += cache.content.length;
  logger.debug(`fetch: cache: global: in-memory: footprint: ${cacheMemoryFootprint}`);

  writeCache(url, payload);
  return {
    url,
    headers: headers,
    payload: payload,
    hash: cache.hash
  };
}

async function fetch(url) {
  return new Promise((resolve, reject) => {
    try {
      const uriObject = new URL(url);
      let get = request;
      if (uriObject.protocol == "http:") {
        logger.debug(`fetch: request: ${url}: using requestHTTP`);
        get = requestHTTP;
      }

      const req = get(url, {
        headers: {
          'Connection': 'keep-alive',
          'pragma': 'no-cache',
          'Accept': 'application/json, text/plain, */*',
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'ClashforWindows/0.20.7',
          'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="102"',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          // 'Accept-Encoding': 'gzip, deflate, br', //NOTE: doesn't have any encoding algorithms built into it yet
          'Accept-Language': 'en-US'
        }
      });

      req.once("response", res => {
        logger.debug(`fetch: request: ${url}: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `${url}: ${res.statusCode} ${res.statusMessage
              }`
            )
          );
        }

        let data = '';
        pipeline(
          res,
          new StringReader(),
          new Writable({
            objectMode: true,
            write(content, encoding, cb) {
              if (data) {
                logger.fatal(`fetch: request: ${url}: StringReader: unexpected multiple read`);
                return cb(new Error(`Guess pigs can fly after all`));
              } else {
                data = content;
              }
              return cb();
            }
          }),
          err => err ? reject(err) : resolve({
            headers: res.headers, payload: data, url
          }
          )
        );
      });
      req.once("error", reject);
      req.once("close", () => reject(new Error(`${url}: connection prematurely closed.`)));
      req.end();
    } catch (err) {
      return reject(err);
    }
  });
}

const processingRequests = new Map();
async function fetchWrapper(url) {
  url = new URL(url).toString();
  const previousReq = processingRequests.get(url);
  if (previousReq) {
    logger.debug(`fetch: profile: ${url}: found an exisiting same request`);
    return await previousReq;
  }

  const cached = await checkCache(url);
  if (cached) {
    logger.debug(`fetch: profile: ${url}: cached`);
    return cached;
  }

  logger.debug(`fetch: profile: ${url}: fetching`);
  const req = fetch(url);
  processingRequests.set(url, req);
  logger.debug(`fetch: profile: ${url}: recorded as processing`);
  const res = cache(await req.catch(
    err => {
      processingRequests.delete(url);
      logger.debug(`fetch: profile: ${url}: failed: deleted from processing requests`);
      throw err;
    }
  ));
  processingRequests.delete(url);
  logger.debug(`fetch: profile: ${url}: succeeded: deleted from processing requests`);
  return res;
}

export { fetchWrapper as fetchProfile, fetchWrapper as fetchRuleset };