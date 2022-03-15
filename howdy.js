import TOML from '@iarna/toml'
import { exec, spawn } from 'child_process';
import { promises as fsp, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetchRuleset } from './fetch.js';
import { createHash } from 'crypto';
import sanitize from 'sanitize-filename';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function callWrangler () {
  await new Promise((resolve, reject) => {
    exec("wrangler --version", { cwd: __dirname, env: process.env }, (err, stdin, stderr) => {
      if(err) {
        return reject(err);
      }
      return resolve();
    });
  });

  const wranglerSettings = TOML.parse(
    await fsp.readFile("wrangler.toml", "utf-8")
  );

  const mandates = [
    "account_id", "zone_id",
    "route", "site.bucket", "site.entry-point"
  ];

  for (const requirement of mandates) {
    if(!requirement.split(".").reduce(
      (value, property) => value?.[property], wranglerSettings
    )) {
      throw new TypeError(`${requirement} is required in wrangler.toml`);
    }
  }

  return `https://${wranglerSettings.route.slice(
    0, wranglerSettings.route.match(
      /\/\*|\/[^/]*$/
    )?.index || wranglerSettings.route.length
  )}`;
}

async function wrangle (silent = false) {
  await new Promise((resolve, reject) => {
    const child = spawn("wrangler", [ "publish" ], {
      shell: !silent, stdio: [
        "ignore", 
        silent ? "ignore" : "pipe", 
        silent ? "inherit" : "inherit"
      ], env: {
        ...process.env,
        "FORCE_COLOR": process.env["FORCE_COLOR"] || 1
      }, cwd: __dirname
    });

    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0)
        return resolve();
      return reject(new Error(
        `Command 'wrangler publish' returns non-zero exit code ${code}`
      ));
    });

    if(!silent)
      child.stdout.on("data", data => process.stdout.write(data));
  });
}

let ranchLocation = "http://localhost/";
const wranglerContactAddress = join(__dirname, "external-rulesets");

async function tryCallWrangling () {
  try {
    ranchLocation = await callWrangler();
    return true;
  } catch (err) {
    console.error(err.message);
    return false;
  }
}

const mover = {
  onShift: false,
  shiftStarts: Date.now(),
  shiftEndsTimer: 0,
  shiftEndsAction (isSilent) {
    this.onShift = false;

    if(!this.defective) {
      if(this.wrangling) {
        return this.wranglingScheduled = true;
      }
  
      this.wrangling = true;
      wrangle(isSilent).catch( // allowing concurrent wrangling
        err => {
          this.defective = true;
          console.error(err);
        }
      ).finally(
        () => {
          this.wrangling = false;
          if(this.wranglingScheduled) {
            this.wranglingScheduled = false;
            return this.shiftEndsAction(isSilent);
          }
        }
      )
    }
  },
  defective: false,
  movedList: new Set(),
  locks: new Map(),
  async lock(key) {
    const lock = this.locks.get(key);
    if (lock) {
      await lock.promise;
      return this.lock(key);
    }

    const newLock = {};
    newLock.promise = new Promise(res => newLock.unlock = res);
    this.locks.set(key, newLock);
  },
  async unlock(key) {
    const lock = this.locks.get(key);
    if (lock) {
      this.locks.delete(key);
      lock.unlock();
      await lock.promise;
    }
  },
  async move(text, location, silently) {
    if(this.defective) {
      throw new Error("Cut me some slack you have to i beg u");
    }

    if(this.onShift) {
      if (Date.now() - this.shiftStarts > 60_000) {
        this.shiftStarts = Date.now();
        setImmediate(() => this.shiftEndsAction(silently));
      }
      clearTimeout(this.shiftEndsTimer);
    } else {
      this.onShift = true;
      this.shiftStarts = Date.now();
    }

    this.shiftEndsTimer = setTimeout(
      () => this.shiftEndsAction(silently), this.wrangling ? 200 : 1500
    );

    this.movedList.add(location);
    try {
      await this.lock(location);
      await fsp.writeFile(location, text, "utf-8");
    } catch (err) {
      if(err.code === "ENOENT") {
        try {
          await fsp.mkdir(wranglerContactAddress, { recursive: true });
          await fsp.writeFile(
            location, text, "utf-8"
          )
        } catch (err) {
          this.defective = true;
          console.error(err);
        }
      } else {
        this.defective = true;
        console.info(
          `Accessing ${
            destination
          } failed. Will stop trying putting the SSOT in place`
        );

        throw err;
      }
    } finally {
      await this.unlock(location);
    }
  },
  scheduled: new Set(),
  scheduleReplace(text, location, silently) {
    if(this.scheduled.has(location)) {
      return
    }

    this.scheduled.add(location)
    this.move(text, location, silently)
      .then(
        () => {
          setTimeout(
            () => this.scheduled.delete(location),
            3000
          ).unref();
        },
        err => {
          console.error(err);
          this.scheduled.delete(location);
        }
      );
  },
  isOccupied (location) {
    if(this.movedList.has(location)) { 
      return true;
    } else {
      return existsSync(location);
    }
  }
}

function sha1(str) {
  return createHash('sha1').update(str).digest('hex');
}

async function rehouse (profile, silently) {
  if(mover.defective || !profile["rule-providers"]) {
    return profile;
  }

  await Promise.all(
    Object.values(profile["rule-providers"]).map(
      async ruleProvider => {
        if(ruleProvider?.type === "http") {
          try {
            const url = ruleProvider.url;
            const pathname = new URL(url).pathname;
            const slashCount = (pathname.match(/\//g) || []).length;
            const tag1 = pathname.slice(pathname.lastIndexOf("/"), pathname.length).replace(/\..+$/, "");
            const tag2 = slashCount > 2 ? pathname.replace(/^(\/(gh|git))?\/([^/]+)\/.*$/, "$3") : "";
            const breed = `${tag2}-${tag1}`.toLowerCase();
            const { payload: horse, hash } = await fetchRuleset(url);
            const identification = hash.slice(0, 8);
    
            const horseStall = sanitize(`${breed}-${identification}`);
            const destination = join(wranglerContactAddress, horseStall);
            if(mover.defective) {
              return ;
            }
            
            if(mover.isOccupied(destination)) {
              mover.scheduleReplace(horse, destination, silently);
            } else {
              await mover.move(horse, destination, silently);
            }
    
            ruleProvider.url = `${ranchLocation}/${horseStall}`;
            ruleProvider.path = `./ruleset/${horseStall}`;
          } catch (err) {
            if(!mover.defective) {
              console.error(err);
            } else {
              throw err;
            } 
          }
        }
      }
    )
  );

  return profile;
} 

export { wrangle, callWrangler, tryCallWrangling, rehouse };