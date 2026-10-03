import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockList, isIP } from 'node:net';
import { existsSync } from 'node:fs';
import { load, dump } from 'js-yaml';
import { consolidate } from '../index.js';

const root = new URL('../', import.meta.url);
const domains = ['anthropic.com', 'api.anthropic.com', 'console.anthropic.com',
  'statsig.anthropic.com', 'claude.ai', 'api.claude.ai', 'claude.com',
  'platform.claude.com', 'code.claude.com', 'claudeusercontent.com',
  'files.claudeusercontent.com', 'claudemcpclient.com',
  'aws-external-anthropic.us-east-1.api.aws', 'new-claude-service.example',
  'clau.de', 'claude.dev', 'files.claudemcpcontent.com',
  'servd-anthropic-website.b-cdn.net', 'cdn.usefathom.com', 'cdn.growthbook.io',
  'o123.ingest.us.sentry.io', 'statsig.com', 'events.statsigapi.net',
  'http-intake.logs.datadoghq.com', 'http-intake.logs.us5.datadoghq.com',
  'browser-intake-us5-datadoghq.com', 'widget.intercom.io', 'js.intercomcdn.com',
  'storage.googleapis.com', 'challenges.cloudflare.com', 'trace.anthropic.com'];
function firstMatch(rules, host, process = '') {
  return rules.find(rule => {
    const [type, value] = rule.split(',');
    if (type === 'IP-CIDR' || type === 'IP-CIDR6') {
      if (!isIP(host)) return false;
      const [ip, prefix] = value.split('/');
      const list = new BlockList();
      list.addSubnet(ip, Number(prefix), isIP(ip) === 6 ? 'ipv6' : 'ipv4');
      return list.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');
    }
    if (type === 'PROCESS-NAME') return process === value;
    return type === 'MATCH' || (type === 'DOMAIN' && host === value) ||
      (type === 'DOMAIN-SUFFIX' && (host === value || host.endsWith(`.${value}`))) ||
      (type === 'DOMAIN-KEYWORD' && host.includes(value));
  })?.split(',')[2];
}

test('all templates and consolidated profiles route Claude before conflicting overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anthropic-routing-'));
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('connection', 'close');
    res.end(dump({ proxies: ['Test US', '[TAG] L.A. 02 1x', '[TAG] L.A. 06 1x',
      '[TAG] L.A. 12 1x', '[TAG] L.A. 16 1x', '[TAG] L.A. 01 2x',
      '[TAG] Seattle 02 1x', '[Ytoo] U.S. 02'].map(name => ({
        name, type: 'ss', server: '127.0.0.1', port: 12345,
        cipher: 'aes-128-gcm', password: 'fixture-only' })) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profiles = join(dir, 'profiles.mjs');
    await writeFile(profiles, `export default ${JSON.stringify([{
      url: `http://127.0.0.1:${server.address().port}/routing-test`,
      rules: { prepended: ['DOMAIN-SUFFIX,anthropic.com,OpenAI', 'MATCH,DIRECT'],
        appended: ['DOMAIN-SUFFIX,claude.com,DIRECT'] }
    }])};`);
    const injections = join(dir, 'injections.yml');
    await writeFile(injections, dump({ OpenAI: { payload: ['DOMAIN-SUFFIX,claude.ai,OpenAI'] } }));
    for (const name of ['meta', 'mobile', 'tun']) {
      const template = fileURLToPath(new URL(`templates/${name}.yml`, root));
      const raw = load(await readFile(template, 'utf8'));
      const generated = await consolidate(template, profiles, injections);
      for (const config of [raw, load(dump(generated))]) {
        assert.equal(config['proxy-groups'].filter(g => g.name === 'Anthropic').length, 1);
        for (const host of domains) assert.equal(firstMatch(config.rules, host), 'Anthropic', `${name}: ${host}`);
        assert.notEqual(firstMatch(config.rules, 'api.openai.com'), 'Anthropic');
        assert.notEqual(firstMatch(config.rules, 'example.org'), 'Anthropic');
        for (const ip of ['160.79.104.1', '160.79.105.255', '2607:6bc0::1']) {
          assert.equal(firstMatch(config.rules, ip), 'Anthropic');
        }
        for (const ip of ['160.79.106.1', '34.162.46.92', '1.1.1.1', '2607:6bc1::1']) {
          assert.notEqual(firstMatch(config.rules, ip), 'Anthropic');
        }
        for (const process of ['claude', 'Claude', 'claude.exe', 'Claude Helper (Renderer)']) {
          assert.equal(firstMatch(config.rules, '1.1.1.1', process), 'Anthropic');
        }
        assert.notEqual(firstMatch(config.rules, '1.1.1.1', 'node'), 'Anthropic');
        assert.equal(config.sniffer['parse-pure-ip'], true);
        assert.equal(config.sniffer.enable, true);
        const block = config.rules.filter(r => r.split(',')[2] === 'Anthropic');
        assert.deepEqual(config.rules.slice(0, block.length), block);
        assert.equal(new Set(block).size, block.length);
      }
      const group = generated['proxy-groups'].find(g => g.name === 'Anthropic');
      assert.equal(group.type, 'select');
      assert.ok(group.proxies.includes('Test US'));
      assert.ok(group.proxies.includes('Proxy'));
      assert.ok(generated['proxy-groups'].some(g => g.name === 'OpenAI'));
      // Older/custom templates also receive the independent group and rules.
      raw['proxy-groups'] = raw['proxy-groups'].filter(g => g.name !== 'Anthropic');
      raw.rules = raw.rules.filter(r => r.split(',')[2] !== 'Anthropic');
      const legacy = join(dir, `${name}.yml`);
      await writeFile(legacy, dump(raw));
      const upgraded = await consolidate(legacy, profiles, injections);
      assert.ok(upgraded['proxy-groups'].some(g => g.name === 'Anthropic'));
      for (const host of domains) assert.equal(firstMatch(upgraded.rules, host), 'Anthropic');
      const filtered = join(dir, `filtered-${name}.mjs`);
      await writeFile(filtered, `export {default} from ${JSON.stringify(profiles)};
        export const proxyGroupFilters = {Anthropic: p => /L\\.A\\. 0[26] /.test(p.name)};`);
      const restricted = await consolidate(template, filtered, injections);
      assert.deepEqual(restricted['proxy-groups'].find(g => g.name === 'Anthropic').proxies,
        ['[TAG] L.A. 02 1x', '[TAG] L.A. 06 1x']);
      const empty = join(dir, `empty-${name}.mjs`);
      await writeFile(empty, `export {default} from ${JSON.stringify(profiles)};
        export const proxyGroupFilters = {Anthropic: () => false};`);
      await assert.rejects(consolidate(template, empty, injections), /No eligible nodes/);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

// Private profiles.js is intentionally ignored by Git; validate it when present.
test('private profile policy only accepts LA node IDs 02 and 06, all templates retain inputs',
  {skip: !existsSync(new URL('../profiles.js', import.meta.url))}, async () => {
    const { default: profiles, proxyGroupFilters } = await import('../profiles.js');
    const accepts = name => proxyGroupFilters.Anthropic({ name });
    for (const name of ['[TAG] L.A. 02 1x', '[TAG] L.A. 06 1x',
      '🇺🇸 美国-洛杉矶 02丨1x US', 'US Los Angeles 6', 'LAX 2']) assert.ok(accepts(name), name);
    for (const name of ['[TAG] L.A. 12 1x', 'L.A. 16', 'L.A. 26', 'L.A. 01 2x',
      'L.A. 01 6倍', 'Seattle 02', '[Ytoo] U.S. 02', 'West Coast 06',
      'L.A. 01 [Expire in 2 days]', 'L.A. 01 [96%]', 'L.A. 01 1x (2)']) assert.ok(!accepts(name), name);
    for (const name of ['tun.yml', 'meta.yml', 'mobile.yml']) {
      assert.ok(profiles.some(p => p.templates.includes(name)), name);
    }
  });
