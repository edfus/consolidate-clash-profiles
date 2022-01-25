#!/usr/bin/env node
import { dump } from 'js-yaml';
import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { consolidate } from "./index.js";
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argvs = process.argv.slice(2);

const extractArg = (matchPattern, offset = 0, defaultValue = false) => {
  for (let i = 0; i < argvs.length; i++) {
    if (matchPattern.test(argvs[i])) {
      const matched = argvs.splice(i, offset + 1);
      return matched.length <= 2 ? matched[offset] : matched.slice(1);
    }
  }
  return defaultValue;
}

const configPath = extractArg(/^--?(i(nput)?|from|profiles)$/, 1, "./profiles.js");
const outputPath = extractArg(/^--?(o(utput)?|to)$/, 1, "./output.yml");
const template = extractArg(/^--?t(emplate)?$/, 1, join(__dirname, "templates/vanilla.yml"));

await fsp.writeFile(
  outputPath, 
  dump(await consolidate(template, configPath)), 
  "utf-8"
);
