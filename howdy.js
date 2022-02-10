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

async function wrangle () {
  await new Promise((resolve, reject) => {
    const child = spawn("wrangler", [ "publish" ], {
      shell: true, stdio: ["ignore", "pipe", "inherit"], env: {
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

    child.stdout.on("data", data => process.stdout.write(data));
  });
}


const ledger = {
  wranglerUnavailable: false,
  wranglerCalled: false,
  wranglerContactAddress: join(__dirname, "external-rulesets"),
  ranchLocation: "http://localhost/",
  prompted: false,
  granted: void 0
};

async function promptForWrangling () {
  if(!ledger.wranglerCalled) {
    ledger.wranglerCalled = true;
    try {
      ledger.ranchLocation = await callWrangler();
    } catch (err) {
      console.error(err.message);
      console.info(
        `Accessing wrangler failed. Will stop trying putting the SSOT in place`
      );
      ledger.wranglerUnavailable = true;
    }
  }

  if(ledger.wranglerUnavailable || ledger.granted === false) {
    throw new Error(
      "ledger.wranglerUnavailable || ledger.granted === false"
    );
  }

  // wouldn't prefer too much verbosity
  if(!ledger.prompted) {
    ledger.prompted = true;
    console.info("Wrangling...");
    ledger.granted = true;
  }
}

const mover = {
  onShift: false,
  shiftEndsTimer: 0,
  shiftEndsAction () {
    this.onShift = false;

    if(!this.defective) {
      if(this.wrangling) {
        return this.wranglingScheduled = true;
      }
  
      this.wrangling = true;
      wrangle().catch( // allowing concurrent wrangling
        err => {
          this.defective = true;
          console.error(err);
        }
      ).finally(
        () => {
          this.wrangling = false;
          if(this.wranglingScheduled) {
            this.wranglingScheduled = false;
            return this.shiftEndsAction();
          }
        }
      )
    }
  },
  defective: false,
  movedList: new Set(),
  async move(text, location) {
    if(this.defective) {
      throw new Error("Cut me some slack you have to i beg u");
    }

    if(this.onShift) {
      clearTimeout(this.shiftEndsTimer);
    } else {
      this.onShift = true;
    }

    this.shiftEndsTimer = setTimeout(
      () => this.shiftEndsAction(), this.wrangling ? 200 : 1500
    );

    try {
      await fsp.writeFile(location, text, "utf-8");
    } catch (err) {
      if(err.code === "ENOENT") {
        try {
          await fsp.mkdir(ledger.wranglerContactAddress, { recursive: true });
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
    }

    this.movedList.add(location);
  },
  scheduleReplace(text, location) {
    this.move(text, location).catch(console.error);
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

async function rehouse (profile) {
  if(mover.defective) {
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
            const { payload: horse } = await fetchRuleset(url);
            const identification = sha1(horse).slice(0, 8);
    
            const horseStall = sanitize(`${breed}-${identification}`);
            const destination = join(ledger.wranglerContactAddress, horseStall);
            if(mover.isOccupied(destination)) {
              mover.scheduleReplace(horse, destination);
            } else {
              await mover.move(horse, destination);
            }
    
            ruleProvider.url = `${ledger.ranchLocation}/${horseStall}`;
            ruleProvider.path = `./ruleset/${horseStall}`;
          } catch (err) {
            if(!mover.defective)
              console.error(err);
          }
        }
      }
    )
  );

  return profile;
} 

export { wrangle, callWrangler, promptForWrangling, rehouse };