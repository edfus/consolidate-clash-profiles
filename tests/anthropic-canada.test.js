import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dump } from 'js-yaml';
import { consolidate } from '../index.js';
import { isAnthropicNode, isPreferredAnthropicNode, anthropicPreferredNode as primary,
  anthropicBackupNode as backup } from '../policies/anthropic.js';

const policy = new URL('../policies/anthropic.js', import.meta.url).href;

test('Anthropic exact two-node allowlist excludes provider and numeric lookalikes', () => {
  assert.ok(isAnthropicNode({name:primary}));
  assert.ok(isAnthropicNode({name:backup}));
  assert.ok(isPreferredAnthropicNode({name:primary}));
  assert.ok(!isPreferredAnthropicNode({name:backup}));
  for (const name of ['[Ytoo] Japan 01','[Ytoo] Japan 2','[Ytoo] Japan 020',
    '[Ytoo] Japan 02x','[TAG] Japan 02','[Ytoo] U.S. 02','[TAG] Japan-5G网络 1x',
    '[TAG] Japan-5G网络 10x (2)','[TAG] Canada- Residential 03 1x',
    'Proxy','DIRECT','ASMR','Japan','🇯🇵 5G','🇨🇦 03']) {
    assert.ok(!isAnthropicNode({name}), name);
    assert.ok(!isPreferredAnthropicNode({name}), name);
  }
  assert.ok(!isAnthropicNode({}));
});

test('all templates prefer Ytoo Japan 02, retain TAG Japan 5G as manual backup and fail closed without either', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anthropic-selector-'));
  let names = [backup,'[TAG] Canada- Residential 03 1x',primary,'[Ytoo] Japan 020'];
  const server = createServer((req,res) => {
    res.setHeader('connection','close');
    res.end(dump({proxies:names.map(name => ({name,type:'ss',server:'127.0.0.1',port:12345,
      cipher:'aes-128-gcm',password:'fixture-only'}))}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const cases = [
      {label:'both',nodes:[...names],expected:[primary,backup]},
      {label:'only-backup',nodes:[backup,'Canada 03'],expected:[backup]},
      {label:'only-primary',nodes:[primary,'[Ytoo] Japan 020'],expected:[primary]},
      {label:'neither',nodes:['[TAG] Canada- Residential 03 1x','[Ytoo] Japan 020'],expected:null},
    ];
    for (const item of cases) {
      names=item.nodes;
      const inputs=join(dir,item.label+'.mjs');
      await writeFile(inputs, `export default [{url:'http://127.0.0.1:${server.address().port}/${item.label}'}];
        export {proxyGroupFilters,proxyGroupPriorities} from ${JSON.stringify(policy)};`);
      for (const template of ['meta','mobile','tun']) {
        if (!item.expected) {
          await assert.rejects(consolidate(new URL(`../templates/${template}.yml`,import.meta.url).pathname,inputs),/No eligible nodes/);
          continue;
        }
        const c=await consolidate(new URL(`../templates/${template}.yml`,import.meta.url).pathname,inputs);
        const group=c['proxy-groups'].find(g=>g.name==='Anthropic');
        assert.equal(group.type,'select');
        assert.deepEqual(group.proxies,item.expected);
        assert.deepEqual(c.proxies.map(p=>p.name),names);
      }
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
