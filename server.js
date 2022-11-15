import { App } from "@edfus/file-server";
import { promises as fsp } from "fs";
import { extname, join } from "path";
import sanitize from "sanitize-filename";

import { consolidate, consolidateQuantumultConf } from "./index.js";
import { tryCallWrangling, rehouse } from "./howdy.js";
import { freemem } from "os";
import { dump } from "js-yaml";
import { inspect } from "util";
import logger, { loggerMiddleware } from "./logger.js";
import { pathToFileURL } from "url";
import { stat } from "fs/promises";

const app = new App();
app.use(
  loggerMiddleware
)
app
  .use(
    async (ctx, next) => {
      const startAt = process.hrtime();
      await next();
      const diff = process.hrtime(startAt)
      const time = diff[0] * 1e3 + diff[1] * 1e-6
      logger.info([
        `${ctx.ip} ${ctx.req.method} ${ctx.req.url}`,
        ctx.res.statusCode, `${time.toFixed(3)}ms`
      ].join(" "));
    }
  )
  .on("error", err => {
    if(err.status != 404) {
      logger.error(err);
    }
  })
;

const templateFolder = "./templates";
const profilesPath = "./profiles.js";
const injectionsPath = "./injections.yml";

const codes = {
  items: [],
  mappings: {}
};

await updateCodes();
async function updateCodes () {
  const items = (
    await fsp.readdir(templateFolder, { withFileTypes: true })
  ).filter(
    dirent => dirent.isFile() && /\.(ya?ml|conf)$/.test(dirent.name)
  ).map(item => item.name);

  const mappings = await fsp.readFile(
    join(templateFolder, "mappings.json"), "utf-8"
  ).then(JSON.parse).catch(_ => { return {} });

  // the modifications of the properties of codes should
  // occur at the same time
  codes.items = items; 
  codes.mappings = {};
  codes.mappingsReversed = {};

  for (const [itemname, codename] of Object.entries(mappings)) {
    if(items.includes(itemname)) {
      codes.mappings[codename] = itemname;
      codes.mappingsReversed[itemname] = sanitize(codename);
    }
  }
}

setInterval(updateCodes, 2000);

const searchParamToBoolean = (stringValue) => {
  switch(stringValue?.toLowerCase()?.trim()){
      case "true": 
      case "yes": 
      case "1": 
      case "":
      case "[]":
        return true;

      case "false": 
      case "no": 
      case "0": 
      case undefined:
      case null: 
        return false;

      default: 
        return false;
  }
}

app.use(async (ctx, next) => {
  const { req, res, state } = ctx;
  const url = state.uriObject;

  ctx.assert(["GET", "HEAD"].includes(req.method), 405, `Unexpected Method ${req.method}`);

  const code = url.searchParams.get("code") || url.searchParams.get("file") || url.searchParams.get("name");
  const profile = searchParamToBoolean(url.searchParams.get("backup")) ? "backup" : url.searchParams.get("profile");
  const user = req.headers["x-user"];

  if(!code) {
    return next();
  }

  const options = {
    profile: profile || "default",
    user: user || "default",
    templateName: "",
    dispositionName: "Download",
    uuid: 0 //TODO
  }

  if(codes.mappings[code]) {
    options.templateName = codes.mappings[code];
    options.dispositionName = sanitize(code);
    return serve(req, res, options);
  }

  for (const item of codes.items) {
    if(item === code) {
      options.templateName = item;
      options.dispositionName = codes.mappingsReversed[item] || item;
      return serve(req, res, options);
    }
  }

  for (const [item, itemCode] of Object.entries(codes.mappingsReversed)) {
    if(item.toLowerCase().startsWith(code.toLowerCase())) {
      options.templateName = item;
      options.dispositionName = codes.mappingsReversed[item] || item;
      return serve(req, res, options);
    }
    if(itemCode.toLowerCase().startsWith(code.toLowerCase())) {
      options.templateName = item;
      options.dispositionName = codes.mappingsReversed[item] || item;
      return serve(req, res, options);
    }
  }

  return next();
});

const cacheStore = new Map();

async function checkCache (cacheID, options) {
  const cache = cacheStore.get(cacheID);

  if(!cache) {
    return null;
  }

  const timeElapsed = Date.now() - cache.timestamp;
  if(timeElapsed >= cache.maxAge) {
    return null;
  }

  if(timeElapsed >= cache.minFresh) {
    scheduleRefresh(cacheID, options);
  }

  cache.lastAccess = Date.now();

  if(cache.content) {
    return cache.content;
  }

  if(cache.error) {
    scheduleRefresh(cacheID, options);
    throw cache.error;
  }

  cacheStore.delete(cacheID);
  return null;
}

function gzip(params) {
  
}

const schedules = new Set();
function scheduleRefresh(freshID, options) {
  if(schedules.has(freshID)) {
    return ;
  }

  logger.debug(`server: response: cache: ${freshID}: refreshing`);
  schedules.add(freshID);
  consolidateAndWrangle(options).then(content => cache(freshID, content))
  .catch(err => {
    logger.error(err);
    cache(freshID, err);
  }).finally(() => {
    schedules.delete(freshID);
  });
}

let cacheMemoryFootprint = 0;
function pruneCacheStore () {
  for (const [key, cache] of cacheStore.entries()) {
    const timeElapsed = Date.now() - cache.lastAccess;
    if(
      freemem() < cacheMemoryFootprint * 2 * 8 // UTF-16
      || timeElapsed > 60_0_000) { // 10 minutes
      cacheMemoryFootprint -= cache.content?.length || 0;
      cacheStore.delete(key);
    } else {
    }
  }
}

setInterval(pruneCacheStore, 2000).unref();

function cache(cacheID, payload) {
  if(payload instanceof Error) {
    const cached = cacheStore.get(cacheID);
    if(cached) {
      cached.error = payload;
      cached.lastAccess = Date.now();
      return ;
    } else {
      const cache = {
        maxAge: 40_000,
        minFresh: 3_000,
        content: null,
        lastAccess: Date.now(),
        timestamp: Date.now(),
        error: payload
      };

      cacheStore.set(cacheID, cache);
      return ;
    }
  }

  const cache = {
    maxAge: 60_000,
    minFresh: 30_000,
    content: payload,
    lastAccess: Date.now(),
    timestamp: Date.now(),
    error: null
  };

  cacheStore.set(cacheID, cache);
  cacheMemoryFootprint += cache.content?.length || 0;
}

let wranglerOnline = false;
let lastCallTimestamp = 0;

let lastProfilesImport = Date.now();
const profileFileURL = pathToFileURL(profilesPath);

let mtime = 0;
let profileFileDirty = true;
setInterval(
  async () => {
    try {
      const stats = await stat(profilesPath);
      if (mtime === stats.mtime) return profileFileDirty = false;
      mtime = stats.mtime;
      profileFileDirty = true;
    } catch (err) {
      logger.error(err, `server: file monitor: stat: ${profilesPath}: errored`)
    }
  },
  10_000
).unref()

async function consolidateAndWrangle (options) {
  const templatePath = options.templatePath;
  const user = options.user;
  const userProfile = options.profile;
  if(profileFileDirty || Date.now() - lastProfilesImport > 60_0_000) {
    lastProfilesImport = Date.now();
    profileFileURL.searchParams.set("ver", Math.random().toString(32).slice(6));
  }

  const consolidatedProfiles = await consolidate(
    templatePath, profileFileURL, injectionsPath,
    user, userProfile
  );

  if(!wranglerOnline && Date.now() - lastCallTimestamp > 10_000) {
    lastCallTimestamp = Date.now();
    wranglerOnline = await tryCallWrangling();
    lastCallTimestamp = Date.now();
  }
  
  if(wranglerOnline) {
    try {
      return dump(await rehouse(consolidatedProfiles, true));
    } catch {
      return dump(consolidatedProfiles);
    }
  }

  return dump(consolidatedProfiles);
}

const processingRequests = new Map();
async function constructPayload (reqID, options) {
  const previousReq = processingRequests.get(reqID);
  if(previousReq) {
    return await previousReq;
  }

  const cached = await checkCache(reqID, options);
  if(cached) {
    return cached;
  }
  
  const req = consolidateAndWrangle(options);
  processingRequests.set(reqID, req);
  const res = await req.catch(err => {
    cache(reqID, err);
    processingRequests.delete(reqID);
    throw err;
  });

  cache(reqID, res);
  processingRequests.delete(reqID);
  return res;
}

const mime = {
  "": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".yaml": "application/x-yaml",
  ".conf": "text/plain",
};

async function serve (req, res, options) {
  const templateName = options.templateName;
  const dispositionName = options.dispositionName;
  const templatePath = join(templateFolder, templateName);

  const payloadOptions = {
    user: options.user,
    profile: options.profile,
    templatePath: templatePath,
  };
  const payloadID = `${templatePath}?user=${options.user}&profile=${options.profile}`;

  logger.debug(`server: function: serve: payloadID: ${payloadID}`)
  let data;
  try {
    data = await constructPayload(payloadID, payloadOptions);
  } catch (err) {
    return res.writeHead(500).end(
      process.env.NODE_ENV === "development" ?
        inspect(err) : err.message
    );
  }

  const content = data;

  const filename = dispositionName;
  const fileExtname = extname(filename);

  const type = mime[fileExtname] || "text/plain";
  const charset = "utf8";
  const bufferEncoding = "utf-8";
  const payload = Buffer.from(content, bufferEncoding);

  // const lastModified = stats.mtimeMs;
  // const eTag = this.etag(stats);

  // // conditional request
  // if (
  //   req.headers["if-none-match"] === eTag
  //   ||
  //   (
  //     req.headers["last-modified"] &&
  //     Number(req.headers["last-modified"]) > lastModified
  //   )
  // ) {
  //   return res.writeHead(304).end("Not Modified");
  // }

  const headers = {
    "Content-Type": `${type}${charset ? "; charset=".concat(charset) : ""}`,
    // "Last-Modified": lastModified,
    // "ETag": eTag,
    "Profile-Update-Interval": 6,
    "Subscription-Userinfo": `expire=${process.env.EXPIRE || "2274253409"}`,
    "Accept-Ranges": "bytes"
  };

  if(/^clash/i.test(req.headers["user-agent"])) {
    headers["Content-Disposition"]
      = `attachment; filename="${filename}"`
    ;
  } else {
    headers["Content-Disposition"]
      = `inline`
    ;
  }

  if (payload.byteLength === 0)
    return res.writeHead(204, "Empty file", headers).end();

  if (req.headers["range"]) {
    const length = payload.byteLength;
    const range = req.headers["range"];
    const [startPosSpecified, endPosSpecified] = (
      range.replace(/^bytes=/, "")
        .split("-")
        .map(n => parseInt(n, 10))
    );
    const endPos = isNaN(endPosSpecified) ? length - 1 : endPosSpecified;
    const startPos = isNaN(startPosSpecified) ? length - endPos - 1 : startPosSpecified;

    if (!sequentiallyGreaterThan(-1, startPos, endPos, length)) {
      headers["Content-Range"] = `bytes */${length}`;
      return res.writeHead(416, headers).end();
    }

    const chunk = payload.slice(startPos, endPos + 1);
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${startPos}-${endPos}/${length}`,
      "Content-Length": chunk.byteLength,
    });

    if (req.method.toUpperCase() === "HEAD") {
      return res.end();
    }

    return res.end(chunk);
  } else {
    headers["Content-Length"] = payload.byteLength;
    res.writeHead(200, headers);

    if (req.method.toUpperCase() === "HEAD") {
      return res.end();
    }
  
    return res.end(payload);
  }
}

app.use((ctx) => {
  ctx.throw(404, "404 Not Found");
});

const server = app.listen(80, "0.0.0.0", function () {
  logger.info(
    `The server is running at http://127.0.0.1:${this.address().port}`
  );
})

const shutdown = async () => {
  server.unref().close()
};

process.once("SIGINT", shutdown);
process.once("SIGQUIT", shutdown);

function sequentiallyGreaterThan(...nums) {
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] >= nums[i + 1]) {
      return false;
    }
  }
  return true;
}