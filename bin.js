#!/usr/bin/env node
import { dump } from 'js-yaml';
import { promises as fsp } from 'fs';
import { dirname, extname, join } from 'path';
import { consolidate, consolidateQuantumultConf } from "./index.js";
import { fileURLToPath } from 'url';
import sanitize from 'sanitize-filename';
import { exit } from 'process';

import { tryCallWrangling, rehouse } from "./howdy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flags = [];
const extractArg = (matchPattern, offset = 0, defaultValue = false) => {
  for (let i = 0; i < argv.length; i++) {
    if (matchPattern.test(argv[i])) {
      const matched = argv.splice(i, offset + 1);
      return matched.length <= 2 ? matched[offset] : matched.slice(1);
    }
  }

  flags.push(
    {
      pattern: matchPattern.source,
      type: (
        offset === 0 
        ? 
          "switch" : 
          "param"
      ),
      defaultValue
    }
  );

  return defaultValue;
}

const showHelp = async () => {
  const indentation = " ".repeat(6);
  try {
    const { name, description } = JSON.parse(
      await fsp.readFile(join(__dirname, "package.json"), "utf-8")
    );

    console.info(`${name}${description ? ":" : ""}`);
    description && console.info(`${indentation}${description}:`);
  } catch {}

  const tail = str => {
    const arr = str.split(/[\\/]/).filter(Boolean);
    return arr[arr.length - 1];
  }

  console.info(`\nUsage: `);
  console.info(`\n${indentation}${
    tail(process.argv[0])
  } ${tail(process.argv[1])} <flags>\n`)

  console.info("The flags are:\n")

  for (const flag of flags) {
    const padding = process.stdout.columns / 2 - flag.pattern.length;
    console.info(
      `${indentation}/${flag.pattern}/${
        " ".repeat(padding >= 0 ? padding : 1)
      }[${flag.type}]${ 
        flag.defaultValue
          ? ` (${flag.defaultValue})`
          : ""
      }`
    )
  }
  console.info("\n")
};

const config = extractArg(/^--?(i(nput)?|from|profiles)$/, 1);
const output = extractArg(/^--?(o(utput)?|to)$/, 1);
const template = extractArg(/^--?t(emplate)?$/, 1);
const injections = extractArg(/^--?(j|inject(ions?)?)$/, 1);
const allTemplatesInTheFolder = extractArg(/^--?a(ll)?$/, 0);

if(extractArg(/^--?h(elp)?$/, 0)) {
  await showHelp();
  exit(0);
}

const configPath = config || "./profiles.js";
const injectionsPath = (
  !config && !injections
  ? "./injections.yml"
  : void 0
);

if(allTemplatesInTheFolder) {
  const templateFolder = template || "./templates";
  const templates = (
    await fsp.readdir(templateFolder, { withFileTypes: true })
  ).filter(
    dirent => dirent.isFile() && /\.(ya?ml|conf)$/.test(dirent.name)
  ).map(item => item.name);

  const destFolder = output || "output";
  await fsp.mkdir(destFolder, { recursive: true });

  const mappings = await fsp.readFile(
    join(templateFolder, "mappings.json"), "utf-8"
  ).then(JSON.parse).catch(_ => { return {} });

  const promises = [];
  for (const templateName of templates) {
    const templatePath = join(templateFolder, templateName);
    const outputPath = join(
      destFolder, 
      mappings[templateName]
       ? sanitize(mappings[templateName]) 
       : templateName
    );
    
    const promise = consolidateAndWrangle(
      templatePath, configPath, injectionsPath
    ).then(
      textProfile => fsp.writeFile(
        outputPath, 
        textProfile, 
        "utf-8"
      ).then(_ => `${templatePath} => ${outputPath}`)
    );

    promises.push(promise);
  }

  for (const result of await Promise.allSettled(promises)) {
    switch (result.status) {
      case "rejected":
        console.error(result.reason);
        break;
      case "fulfilled":
        console.info(result.value);
    }
  }
} else {
  const templatePath = template || join(__dirname, "templates/vanilla.yml");
  await fsp.writeFile(
    output || `output${extname(templatePath)}`, 
    await consolidateAndWrangle(templatePath, configPath, injectionsPath), 
    "utf-8"
  );
}


const ledger = {
  wranglerUnavailable: false,
  wranglerCalled: false,
  prompted: false,
  granted: void 0
};

async function promptForWrangling () {
  if(!ledger.wranglerCalled) {
    ledger.wranglerCalled = true;
    const ack =  await tryCallWrangling();
    if(!ack) {
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

async function consolidateAndWrangle (...args) {
  if (args[0].endsWith(".conf")) {
    return await consolidateQuantumultConf(...args);
  }

  const profile = await consolidate(...args);
  try {
    await promptForWrangling();
  } catch {
    return dump(profile);
  }

  try {
    return dump(await rehouse(profile));
  } catch (err) {
    console.error(err);
    return dump(profile);
  }
}