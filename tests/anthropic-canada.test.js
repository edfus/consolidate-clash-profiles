import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dump } from 'js-yaml';
import { consolidate } from '../index.js';
import { isCanadaNode, isCanada03Node } from '../policies/anthropic.js';

const policy = new URL('../policies/anthropic.js', import.meta.url).href;

test('Canada-only filtering and exact node 03 preference reject aliases and numeric lookalikes', () => {
  for (const name of ['[TAG] Canada- Residential 03 1x','CANADA 3','加拿大 03 1x','🇨🇦 03']) {
    assert.ok(isCanadaNode({name}), name);
    assert.ok(isCanada03Node({name}), name);
  }
  for (const name of ['Canada 01 3x','Canada 13','Canada 30','Canada 003','Canada 03x',
    'Canada 3倍','Canada 01 [Expire in 3 days]','Canada [Expire in 3 days]',
    'Canada 01 [93%]','Canada 01 1x (3)']) {
    assert.ok(isCanadaNode({name}), name);
    assert.ok(!isCanada03Node({name}), name);
  }
  for (const name of ['[TAG] L.A. 03 1x','California 03','CA 03','Proxy','DIRECT','ASMR','CanadaWest 03']) {
    assert.ok(!isCanadaNode({name}), name);
    assert.ok(!isCanada03Node({name}), name);
  }
  assert.ok(!isCanadaNode({}));
});

test('all generated templates prefer Canada 03, retain other Canadians, and fail closed without Canada', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anthropic-canada-'));
  let names = ['[TAG] Canada- Residential 01 2x','[TAG] L.A. 03 1x',
    '[TAG] Canada- Residential 02 2x','[TAG] Canada- Residential 03 1x','Canada 13','Canada 01 3x'];
  const server = createServer((req,res) => {
    res.setHeader('connection','close');
    res.end(dump({proxies:names.map(name => ({name,type:'ss',server:'127.0.0.1',port:12345,
      cipher:'aes-128-gcm',password:'fixture-only'}))}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const inputs = join(dir,'sources.mjs');
    await writeFile(inputs, `export default [{url:'http://127.0.0.1:${server.address().port}/full'}];
      export {proxyGroupFilters,proxyGroupPriorities} from ${JSON.stringify(policy)};`);
    for (const template of ['meta','mobile','tun']) {
      const c = await consolidate(new URL(`../templates/${template}.yml`,import.meta.url).pathname,inputs);
      assert.deepEqual(c['proxy-groups'].find(g=>g.name==='Anthropic').proxies,
        [names[3],names[0],names[2],names[4],names[5]]);
    }
    names = ['Canada 02','L.A. 03','Canada 01'];
    const fallback=join(dir,'fallback.mjs');
    await writeFile(fallback, `export default [{url:'http://127.0.0.1:${server.address().port}/fallback'}];
      export {proxyGroupFilters,proxyGroupPriorities} from ${JSON.stringify(policy)};`);
    for (const template of ['meta','mobile','tun']) {
      const c=await consolidate(new URL(`../templates/${template}.yml`,import.meta.url).pathname,fallback);
      assert.deepEqual(c['proxy-groups'].find(g=>g.name==='Anthropic').proxies,['Canada 02','Canada 01']);
    }
    names=['L.A. 03'];
    const empty=join(dir,'empty.mjs');
    await writeFile(empty, `export default [{url:'http://127.0.0.1:${server.address().port}/empty'}];
      export {proxyGroupFilters,proxyGroupPriorities} from ${JSON.stringify(policy)};`);
    for (const template of ['meta','mobile','tun']) await assert.rejects(
      consolidate(new URL(`../templates/${template}.yml`,import.meta.url).pathname,empty),/No eligible nodes/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
