import { readFile, mkdir, writeFile, chmod, symlink, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildQuantumultX } from '../generators/quantumultx.js';

// Usage: node scripts/generate-quantumultx.mjs SOURCE_JSON PRIVATE_TEMPLATE PRIVATE_OUTPUT --expected-count=140 --anytls --preserve-source-node-tls
const [sourcePath, templatePath, outputPath, ...flags] = process.argv.slice(2);
const allowed = f => /^--expected-count=\d+$/.test(f) || ['--anytls','--preserve-source-node-tls'].includes(f);
if (!sourcePath || !templatePath || !outputPath || flags.some(f => !allowed(f))) {
  console.error('Expected source JSON, private template, private output directory, --expected-count=N and optional capability flags.');
  process.exit(2);
}
const out = resolve(outputPath);
if (!out.split('/').includes('private')) {
  console.error('Output must be inside a directory named private; generated files contain credentials.');
  process.exit(2);
}
let pending;
try {
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const template = await readFile(templatePath, 'utf8');
  const result = buildQuantumultX(source, template, {
    expectedCount: Number(flags.find(f => f.startsWith('--expected-count='))?.split('=')[1]),
    anytls: flags.includes('--anytls'),
    allowInsecureSourceTLS: flags.includes('--preserve-source-node-tls'),
  });
  await mkdir(out, { recursive: true, mode: 0o700 });
  await chmod(out, 0o700);
  const id = `release-${Date.now()}-${process.pid}`;
  const release = join(out, id);
  await mkdir(release, { mode: 0o700 });
  await writeFile(join(release, 'quanx.conf'), result.config, { mode: 0o600 });
  await writeFile(join(release, 'servers.list'), result.servers, { mode: 0o600 });
  await writeFile(join(release, 'summary.json'), JSON.stringify(result.summary, null, 2) + '\n', { mode: 0o600 });
  pending = join(out, `.current-${process.pid}`);
  await symlink(id, pending);
  await rename(pending, join(out, 'current'));
  pending = undefined;
  console.log(JSON.stringify(result.summary));
} catch (error) {
  if (pending) await rm(pending, { force: true });
  // Never print parser excerpts, node values or filesystem content in errors.
  console.error('Quantumult X generation failed; existing current release is unchanged.');
  if (error.report) console.error(JSON.stringify(error.report));
  process.exitCode = 1;
}
