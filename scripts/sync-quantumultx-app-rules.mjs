import { readFileSync, writeFileSync } from 'node:fs';
import { buildQuantumultXAppRules } from '../generators/quantumultx-app-rules.js';

const file = new URL('../caddy/quantumultx/Apps.list', import.meta.url);
const expected = buildQuantumultXAppRules();
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  console.error('Usage: sync-quantumultx-app-rules.mjs [--check]');
  process.exitCode = 2;
} else if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== expected) {
    console.error('Public Quantumult X app rules are stale');
    process.exitCode = 1;
  }
} else {
  writeFileSync(file, expected);
  console.log('Public Quantumult X app rules updated');
}
