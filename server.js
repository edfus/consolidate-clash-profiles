import { App } from "@edfus/file-server";
import { promises as fsp } from "fs";
import { extname, join } from "path";
import sanitize from "sanitize-filename";

import { consolidate, consolidateQuantumultConf } from "./index.js";
import { tryCallWrangling, rehouse } from "./howdy.js";
import { freemem } from "os";
import { dump } from "js-yaml";
import { inspect } from "util";

const app = new App();
app
  .prepend(
    async (ctx, next) => {
      await next();
      console.info([
        new Date().toLocaleString(),
        `${ctx.ip} ${ctx.req.method} ${ctx.req.url}`,
        ctx.res.statusCode
      ].join(" - "));
    }
  )
  .on("error", err => {
    if(err.status != 404) {
      console.error(err);
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

app.use(async (ctx, next) => {
  const { req, res, state } = ctx;
  const url = state.uriObject;

  ctx.assert(["GET", "HEAD"].includes(req.method), 405, `Unexpected Method ${req.method}`);

  const code = url.searchParams.get("code");

  if(!code) {
    return next();
  }

  if(codes.mappings[code]) {
    return serve(req, res, codes.mappings[code], sanitize(code));
  }

  for (const item of codes.items) {
    if(item === code) {
      return serve(req, res, item, codes.mappingsReversed[item] || item);
    }
  }

  for (const item of codes.items) {
    if(item.toLowerCase().startsWith(code.toLowerCase())) {
      return serve(req, res, item, codes.mappingsReversed[item] || item);
    }
  }

  return next();
});

const cacheStore = new Map();

async function checkCache (filepath) {
  const cache = cacheStore.get(filepath);

  if(!cache) {
    return null;
  }

  const timeElapsed = Date.now() - cache.timestamp;
  if(timeElapsed >= cache.maxAge) {
    return null;
  }

  if(timeElapsed >= cache.minFresh) {
    scheduleRefresh(filepath);
  }

  cache.lastAccess = Date.now();

  if(cache.content) {
    return cache.content;
  }

  if(cache.error) {
    scheduleRefresh(filepath);
    throw cache.error;
  }

  cacheStore.delete(filepath);
  return null;
}

function gzip(params) {
  
}

const schedules = new Set();
function scheduleRefresh(filepath) {
  if(schedules.has(filepath)) {
    return ;
  }

  schedules.add(filepath);
  consolidateAndWrangle(filepath).then(content => cache(filepath, content))
  .catch(err => {
    console.error(err);
    cache(filepath, err);
  }).finally(() => {
    schedules.delete(filepath);
  });
}

let cacheMemoryFootprint = 0;
function pruneCacheStore () {
  for (const [key, cache] of cacheStore.entries()) {
    const timeElapsed = Date.now() - cache.lastAccess;
    if(
      freemem() < cacheMemoryFootprint * 2 * 8 // UTF-16
      || timeElapsed > 2000 * 60) { // 2 minutes
      cacheMemoryFootprint -= cache.content?.length || 0;
      cacheStore.delete(key);
    } else {
      if(!cache.content) {
        scheduleRefresh(key);
      }
    }
  }
}

setInterval(pruneCacheStore, 2000).unref();

function cache(filepath, payload) {
  if(payload instanceof Error) {
    const cached = cacheStore.get(filepath);
    if(cached) {
      cached.error = payload;
      cached.lastAccess = Date.now();
      return ;
    } else {
      const cache = {
        maxAge: 2 * 1000,
        minFresh: 0,
        content: null,
        lastAccess: Date.now(),
        timestamp: Date.now(),
        error: payload
      };

      cacheStore.set(filepath, cache);
      return ;
    }
  }

  const cache = {
    maxAge: (5) * 1000,
    minFresh: (.3) * 1000,
    content: payload,
    lastAccess: Date.now(),
    timestamp: Date.now(),
    error: null
  };

  cacheStore.set(filepath, cache);
  cacheMemoryFootprint += cache.content?.length || 0;
}

let wranglerOnline = false;
let lastCallTimestamp = 0;

let lastProfilesImport = Date.now();
let lastProfilesPath = profilesPath;
async function consolidateAndWrangle (templatePath) {
  if(Date.now() - lastProfilesImport > 3000) {
    lastProfilesImport = Date.now();
    lastProfilesPath = profilesPath.concat(
      `?${Math.random().toString(32).slice(6)}`
    );
  }

  const profilesFilePath = lastProfilesPath;
  
  if (templatePath.endsWith(".conf")) {
    return await consolidateQuantumultConf(templatePath, profilesFilePath);
  }

  const profile = await consolidate(templatePath, profilesFilePath, injectionsPath);
  if(!wranglerOnline && Date.now() - lastCallTimestamp > 5_000) {
    lastCallTimestamp = Date.now();
    wranglerOnline = await tryCallWrangling();
    lastCallTimestamp = Date.now();
  }
  
  if(wranglerOnline) {
    try {
      return dump(await rehouse(profile, true));
    } catch {
      return dump(profile);
    }
  }

  return dump(profile);
}

const processingRequests = new Map();
async function constructPayload (filepath) {
  const previousReq = processingRequests.get(filepath);
  if(previousReq) {
    return await previousReq;
  }

  const cached = await checkCache(filepath);
  if(cached) {
    return cached;
  }
  
  const req = consolidateAndWrangle(filepath);
  processingRequests.set(filepath, req);
  const res = await req.catch(err => {
    cache(filepath, err);
    processingRequests.delete(filepath);
    throw err;
  });

  cache(filepath, res);
  processingRequests.delete(filepath);
  return res;
}

const mime = {
  "": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".yaml": "application/x-yaml",
  ".conf": "text/plain",
};

async function serve (req, res, templateName, dispositionName) {
  const templatePath = join(templateFolder, templateName);

  let data;
  try {
    data = await constructPayload(templatePath);
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

  if (content.size === 0)
    return res.writeHead(204, "Empty file", headers).end();

  if (req.headers["range"]) {
    const range = req.headers["range"];
    const [startPosSpecified, endPosSpecified] = (
      range.replace(/^bytes=/, "")
        .split("-")
        .map(n => parseInt(n, 10))
    );
    const endPos = isNaN(endPosSpecified) ? content.length - 1 : endPosSpecified;
    const startPos = isNaN(startPosSpecified) ? content.length - endPos - 1 : startPosSpecified;

    if (!sequentiallyGreaterThan(-1, start, end, content.length)) {
      headers["Content-Range"] = `bytes */${content.length}`;
      return res.writeHead(416, headers).end();
    }

    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${content.length}`,
      "Content-Length": String(end - start + 1),
    });

    if (req.method.toUpperCase() === "HEAD") {
      return res.end();
    }

    return res.end(content.slice(startPos, endPos + 1));
  } else {
    headers["Content-Length"] = content.length;
    res.writeHead(200, headers);

    if (req.method.toUpperCase() === "HEAD") {
      return res.end();
    }
  
    return res.end(content);
  }
}

app.use((ctx) => {
  ctx.throw(404, "404 Not Found");
});

const server = app.listen(80, "0.0.0.0", function () {
  console.info(
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