import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('private CLI publishes complete releases; failure retains prior release without disclosing secrets', async () => {
 const root = await mkdtemp(join(tmpdir(),'qx-generation-'));
 try {
  const dir=join(root,'private'); await mkdir(dir);
  const source=join(dir,'source.json'), template=join(dir,'template.conf'), out=join(dir,'output');
  const obj={proxies:[{name:'Synthetic',type:'trojan',server:'example.com',port:443,password:'secret-fixture-never-log'}],'proxy-groups':[{name:'Anthropic',proxies:['Synthetic']}]};
  await writeFile(source,JSON.stringify(obj));
  await writeFile(template,'[policy]\nstatic = Anthropic,Outside\nstatic = AI Suite,Outside\n[server_local]\n[server_remote]\n[filter_remote]\n[filter_local]\nfinal,Others\n');
  const args=['scripts/generate-quantumultx.mjs',source,template,out,'--expected-count=1'];
  const ok=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(ok.status,0);
  assert.doesNotMatch(ok.stdout+ok.stderr,/secret-fixture-never-log/);
  const before=await readlink(join(out,'current'));
  assert.equal((await stat(join(out,'current','quanx.conf'))).mode & 0o777,0o600);
  assert.equal((await stat(out)).mode & 0o777,0o700);
  obj.proxies[0].password='bad,secret-fixture-never-log';await writeFile(source,JSON.stringify(obj));
  const bad=spawnSync(process.execPath,args,{encoding:'utf8'});assert.notEqual(bad.status,0);
  assert.doesNotMatch(bad.stdout+bad.stderr,/secret-fixture-never-log/);
  assert.equal(await readlink(join(out,'current')),before);
  assert.match(await readFile(join(out,'current','servers.list'),'utf8'),/password=secret-fixture-never-log/);
 } finally { await rm(root,{recursive:true,force:true}); }
});
