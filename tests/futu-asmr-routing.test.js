import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';
import { consolidate } from '../index.js';

const root = new URL('../', import.meta.url);
function firstMatch(rules, host, process = '') {
  const rule = rules.find(rule => {
    const [type, value] = rule.split(',');
    return type === 'MATCH' || (type === 'DOMAIN' && host === value) ||
      (type === 'DOMAIN-SUFFIX' && (host === value || host.endsWith(`.${value}`))) ||
      (type === 'DOMAIN-KEYWORD' && host.includes(value)) ||
      (type === 'PROCESS-NAME' && process === value);
  });
  return rule?.split(',').at(-1);
}

test('all final profiles prioritize Futu/ASMR and restrict ASMR to HK/JP nodes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'futu-asmr-'));
  const names = ['Test US', 'Japan 01', '[TAG] Hong Kong 01', '🇯🇵 Tokyo',
    '🇭🇰 香港 02', 'HK-03', 'JP-04', 'SHKnot-region', 'JProxy', 'Singapore'];
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('connection', 'close');
    res.end(dump({ proxies: names.map(name => ({ name, type: 'ss',
      server: '127.0.0.1', port: 12345, cipher: 'aes-128-gcm', password: 'fixture' })) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profiles = join(dir, 'profiles.mjs');
    await writeFile(profiles, `export default ${JSON.stringify([{
      url: `http://127.0.0.1:${server.address().port}/fixture`,
      rules: { prepended: ['DOMAIN-SUFFIX,asmr.one,DIRECT',
        'DOMAIN-SUFFIX,futunn.com,DIRECT', 'MATCH,DIRECT'] },
      proxyGroups: [{ name: 'ASMR', exclusive: true,
        payload: { name: 'ASMR', type: 'select', proxies: ['Proxy', 'DIRECT'] } }]
    }])};`);
    const injections = join(dir, 'injections.yml');
    await writeFile(injections, dump({ Proxy: { payload: ['DOMAIN-SUFFIX,futu.cn,DIRECT'] } }));
    const futu = load(await readFile(new URL('rules/Futu.yml', root), 'utf8')).payload;
    assert.equal(new Set(futu).size, futu.length);
    assert.ok(futu.every(rule => !rule.startsWith('IP-CIDR') && !rule.startsWith('DOMAIN-KEYWORD')));
    for (const template of ['meta', 'mobile', 'tun']) {
      const path = fileURLToPath(new URL(`templates/${template}.yml`, root));
      const raw = load(await readFile(path, 'utf8'));
      const config = load(dump(await consolidate(path, profiles, injections)));
      for (const c of [raw, config]) {
        for (const host of ['asmr.one', 'api.asmr.one', 'media.asmr.one']) {
          assert.equal(firstMatch(c.rules, host), 'ASMR');
        }
        for (const rule of futu) {
          const [type, value] = rule.split(',');
          if (type === 'PROCESS-NAME') {
            assert.equal(firstMatch(c.rules, '203.0.113.22', value), 'Proxy');
          } else {
            assert.equal(firstMatch(c.rules, value), 'Proxy');
            if (type === 'DOMAIN-SUFFIX') assert.equal(firstMatch(c.rules, `api.${value}`), 'Proxy');
          }
        }
        for (const host of ['asmr.one.example', 'notasmr.one', 'futunn.com.example',
          'moomoo.jp', 'moomoo.com.au', 'shortconn.im.qcloud.com']) {
          assert.notEqual(firstMatch(c.rules, host), 'ASMR');
          assert.ok(!futu.some(r => firstMatch([r + ',Proxy'], host)));
        }
        assert.equal(firstMatch(c.rules, 'api.futunn.com', 'ToDesk'), 'DIRECT');
        assert.equal(firstMatch(c.rules, 'api.anthropic.com', 'FTNN'), 'Anthropic');
      }
      assert.deepEqual(config['proxy-groups'].find(g => g.name === 'ASMR'), {
        name: 'ASMR', type: 'select', proxies: ['[TAG] Hong Kong 01', '🇭🇰 香港 02',
          'HK-03', 'Japan 01', '🇯🇵 Tokyo', 'JP-04']
      });
      assert.equal(config.proxies.length, names.length);
      const refs = new Set(['DIRECT', 'REJECT', ...config.proxies.map(p => p.name),
        ...config['proxy-groups'].map(g => g.name)]);
      for (const g of config['proxy-groups']) {
        assert.ok(g.proxies.length, `${g.name}: empty`);
        for (const ref of g.proxies) assert.ok(refs.has(ref), `${g.name}: invalid reference`);
      }
      // Older templates are upgraded too; no HK/JP nodes cannot fall through to DIRECT.
      raw['proxy-groups'] = raw['proxy-groups'].filter(g => g.name !== 'ASMR');
      raw.rules = raw.rules.filter(r => !r.includes(',ASMR') && !futu.includes(r.replace(/,Proxy$/, '')));
      const legacy = join(dir, `${template}.yml`);
      await writeFile(legacy, dump(raw));
      const onlyUS = join(dir, `${template}-us.mjs`);
      await writeFile(onlyUS, `export default [{url: ${JSON.stringify(`http://127.0.0.1:${server.address().port}/fixture`)}, map: p => p.proxies.filter(p => p.name === 'Test US')}];`);
      const upgraded = await consolidate(legacy, onlyUS);
      assert.deepEqual(upgraded['proxy-groups'].find(g => g.name === 'ASMR').proxies, ['REJECT']);
      assert.equal(firstMatch(upgraded.rules, 'futu.cn'), 'Proxy');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
