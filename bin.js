#!/usr/bin/env node
import { dump } from 'js-yaml';
import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { consolidate } from "./index.js";
import { fileURLToPath } from 'url';
import sanitize from 'sanitize-filename';

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

const config = extractArg(/^--?(i(nput)?|from|profiles)$/, 1);
const output = extractArg(/^--?(o(utput)?|to)$/, 1);
const template = extractArg(/^--?t(emplate)?$/, 1);
const injections = extractArg(/^--?(j|inject(ions?)?)$/, 1);
const allTemplatesInTheFolder = extractArg(/^--?a(ll)?$/, 0);

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
    dirent => dirent.isFile() && /\.ya?ml$/.test(dirent.name)
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
    
    const promise = fsp.writeFile(
      outputPath, 
      dump(await consolidate(templatePath, configPath, injectionsPath)), 
      "utf-8"
    ).then(_ => `${templatePath} => ${outputPath}`);

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
    output || "output.yml", 
    dump(await consolidate(templatePath, configPath, injectionsPath)), 
    "utf-8"
  );
}
