import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { consolidate } from '../index.js';
import { createServer } from 'node:http';

test('generated DNS upstreams cannot resolve through the TUN system stub or their own listener', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dns-routing-'));
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('connection', 'close');
    res.end('proxies:\n  - {name: test, type: ss, server: 127.0.0.1, port: 12345, cipher: aes-128-gcm, password: fixture}\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profiles = join(dir, 'profiles.mjs');
    await writeFile(profiles, `export default [{url: "http://127.0.0.1:${server.address().port}/dns-test"}];\n`);
    for (const name of ['meta', 'mobile', 'tun']) {
      const path = fileURLToPath(new URL(`../templates/${name}.yml`, import.meta.url));
      const raw = load(await readFile(path, 'utf8'));
      const generated = await consolidate(path, profiles);
      for (const { dns } of [raw, generated]) {
        assert.ok(dns.enable, `${name}: keep the internal DNS resolver enabled`);
        assert.equal(dns['enhanced-mode'], 'fake-ip');
        assert.ok(dns.nameserver.length && dns.fallback.length);
        assert.equal(dns['nameserver-policy']['+.cn'], '223.5.5.5');
        const upstreams = [dns['default-nameserver'], dns.nameserver, dns.fallback,
          dns['direct-nameserver'], dns['proxy-server-nameserver'],
          ...Object.values(dns['nameserver-policy'] ?? {})].flat(Infinity).filter(Boolean);
        for (const upstream of upstreams) {
          assert.doesNotMatch(upstream, /^(?:system(?:$|:|\/)|(?:udp|tcp):\/\/127\.0\.0\.1:1053)/,
            `${name}: upstream must not return our own Fake-IP`);
        }
        assert.ok(!dns['direct-nameserver']?.length, `${name}: reuse normal DNS policy for DIRECT`);
        assert.ok(!dns['proxy-server-nameserver']?.length, `${name}: reuse node-domain policies`);
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
