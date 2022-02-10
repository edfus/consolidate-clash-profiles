import { request } from "https";
import { promises as fsp } from 'fs';
import { createHash } from 'crypto';
import { pipeline, Transform, Writable } from "stream";
import sanitize from "sanitize-filename";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parse as parseCacheControl } from "@tusbar/cache-control";
import { freemem } from "os";

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
  if(typeof str !== "string") {
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
  return fsp.readFile(
    join(cacheFolder, filename), "utf-8"
  ).catch(console.error);
}

async function writeCache(url, payload) {
  const filename = sanitize(url);
  try {
    await fsp.writeFile(join(cacheFolder, filename), payload, "utf-8");
  } catch (err) {
    if(err.code === "ENOENT") {
      try {
        await fsp.mkdir(cacheFolder, { recursive: true });
        await fsp.writeFile(
          join(cacheFolder, filename), payload, "utf-8"
        )
      } catch (err) {
        console.error(err);
      }
    } else {
      console.error(err);
    }
  }
}

async function checkCache (url) {
  const cache = cacheStore.get(url);

  if(!cache) {
    return null;
  }

  const timeElapsed = Date.now() - cache.timestamp;
  if(timeElapsed >= cache.maxAge) {
    return null;
  }

  if(timeElapsed >= cache.minFresh) {
    scheduleRefresh(url);
  }

  cache.lastAccess = Date.now();

  if(cache.content) {
    return { url, headers: cache.headers, payload: cache.content };
  }

  const fileContent = await readCache(url);

  if(sha1(fileContent) !== cache.hash) {
    // await fsp.rm(join(cacheFolder, filename), { force: true })
    cacheStore.delete(url);
    return null;
  }

  cacheMemoryFootprint += cache.content.length;
  return { url, headers: cache.headers, payload: cache.content };
}

const schedules = new Set();
function scheduleRefresh(url) {
  if(schedules.has(url)) {
    return ;
  }

  schedules.add(url);
  fetch(url).then(cache).catch(console.error).finally(() => {
    schedules.delete(url);
  });
}

function pruneCacheStore () {
  for (const [key, cache] of cacheStore.entries()) {
    if(cache.content) {
      const timeElapsed = Date.now() - cache.lastAccess;
      if(
        freemem() < cacheMemoryFootprint * 2 * 8 // UTF-16
        || timeElapsed > 1000 * 60) { // 1 minutes
        cacheMemoryFootprint -= cache.content.length;
        cache.content = null;
      }
    }
  }
}

setInterval(pruneCacheStore, 2000).unref();

function cache({ headers, payload, url }) {
  const cacheControl = parseCacheControl(headers["cache-control"]);
  const cache = {
    etag: headers["etag"], // ignored for now
    maxAge: cacheControl.maxAge || 1000,
    minFresh: cacheControl.minFresh || 1,
    content: payload,
    headers: headers, // http.maxHeaderSize
    lastAccess: Date.now(),
    hash: sha1(payload)
  };

  cacheStore.set(url, cache);
  cacheMemoryFootprint += cache.content.length;

  writeCache(url, payload);
}

async function fetch (url) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        "accept": "application/json, text/plain, */*",
        "user-agent": "ClashforWindows/0.19.6",
      }
    });

    req.once("response", res => {
      let data = '';
      pipeline(
        res,
        new StringReader(),
        new Writable({
          objectMode: true,
          write (content, encoding, cb) {
            if (data) {
              return cb(new Error(`Guess pigs can fly`));
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
    req.once("close", reject);
    req.end();
  });
}

const processingRequests = new Map();
async function fetchProfile(url) {
  url = new URL(url).toString();
  const previousReq = processingRequests.get(url);
  if(previousReq) {
    return await previousReq;
  }

  const cached = await checkCache(url);
  if(cached) {
    return cached;
  }
  
  const req = fetch(url);
  processingRequests.set(url, req);
  const res = await req;
  cache(res);
  processingRequests.delete(url);
  return res;
}

export { fetchProfile,  fetchProfile as fetchRuleset }