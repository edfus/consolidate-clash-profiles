import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuantumultX } from '../generators/quantumultx.js';
import { buildQuantumultXAppRules } from '../generators/quantumultx-app-rules.js';

const node = name => ({name, type:'trojan', server:'example.com', port:443, password:'fixture'});
const source = {proxies:['US 02','Japan 01','Hong Kong 01','🇭🇰 香港 02','JP 03'].map(node),
  'proxy-groups':[{name:'Anthropic', proxies:['US 02']},
    {name:'ASMR',type:'select',proxies:['Hong Kong 01','🇭🇰 香港 02','Japan 01','JP 03']}]};
const template = '[general]\nserver_check_url=https://example.com/check\n[policy]\n'
  +'static = Outside,proxy,direct\nstatic = Anthropic,Old\nstatic = AI Suite,Old\n'
  +'static = Others,Outside,direct\n[server_local]\n[server_remote]\n[filter_remote]\n'
  +'https://example.com/cn.list,tag=CN,force-policy=direct,inserted-resource=true,enabled=true\n'
  +'[filter_local]\nhost-suffix,asmr.one,direct\nhost-suffix,futunn.com,direct\nfinal,Others\n'
  +'[dns]\nserver=223.5.5.5\n[rewrite_local]\nfixture-rule\n[mitm]\nskip_validating_cert = false\n';
const split = config => Object.fromEntries([...config.matchAll(/^\[([^\]]+)\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)]
  .map(m=>[m[1],m[2]]));
function firstMatch(text, host) {
  const line=text.split('\n').find(line=>{
    const [raw,value]=line.split(',').map(s=>s.trim());
    const type=raw.toLowerCase();
    return type==='final' || (type==='host' && host===value) ||
      (type==='host-suffix' && (host===value || host.endsWith('.'+value))) ||
      (type==='host-keyword' && host.includes(value));
  });
  const parts=line?.split(',');return parts?.at(-1);
}

test('independent app groups, high-priority remote block and local fallback preserve unrelated sections', () => {
  const output=buildQuantumultX(source,template,{expectedCount:5});
  const sections=split(output.config),before=split(template);
  assert.match(sections.policy,/^static = ASMR,Hong Kong 01,🇭🇰 香港 02,Japan 01,JP 03$/m);
  assert.match(sections.policy,/^static = Futu,proxy,US 02,Japan 01,Hong Kong 01,🇭🇰 香港 02,JP 03$/m);
  assert.match(sections.policy,/^static = Anthropic,US 02$/m);
  for(const name of ['general','dns','rewrite_local','mitm'])assert.equal(sections[name],before[name]);
  assert.ok(sections.filter_remote.startsWith('https://47.95.2.2:8443/quantumultx/Apps.list,tag=App Routing,inserted-resource=true,'));
  assert.ok(!sections.filter_remote.split('\n')[0].includes('force-policy'));
  assert.ok(sections.filter_remote.includes(before.filter_remote));
  assert.equal(firstMatch(sections.filter_local,'asmr.one'),'ASMR');
  assert.equal(firstMatch(sections.filter_local,'api.asmr.one'),'ASMR');
  assert.equal(firstMatch(sections.filter_local,'api.futunn.com'),'Futu');
  assert.equal(firstMatch(sections.filter_local,'cdn.futustatic.com'),'Futu');
  assert.equal(firstMatch(sections.filter_local,'futu.cn'),'Futu');
  assert.equal(firstMatch(sections.filter_local,'api.moomoobull.com'),'Futu');
  assert.equal(firstMatch(sections.filter_local,'relay.todesk.com'),'direct');
  assert.equal(firstMatch(sections.filter_local,'api.anthropic.com'),'Anthropic');
  assert.equal(firstMatch(sections.filter_local,'chatgpt.com'),'AI Suite');
  for(const host of ['notasmr.one','asmr.one.example','futunn.com.example','moomoo.jp','moomoo.com.au']) {
    assert.equal(firstMatch(sections.filter_local,host),'Others');
  }
  assert.equal(output.summary.asmrCandidates,4);
  assert.equal(output.summary.futuDomainRules,47);
  assert.equal(output.summary.omittedFutuProcessRules,4);
  assert.doesNotMatch(sections.filter_local,/PROCESS-NAME|process-name|ip-cidr,119\.28\./i);
  assert.equal(buildQuantumultX(source,output.config,{expectedCount:5}).config,output.config);
});

test('ASMR rejects when regional nodes are absent; ambiguous aliases and nonregional groups fail closed', () => {
  const old={proxies:[node('US 02')],'proxy-groups':[{name:'Anthropic',proxies:['US 02']}]};
  assert.match(buildQuantumultX(old,template,{expectedCount:1}).config,/^static = ASMR,reject$/m);
  for(const proxies of [['Proxy'],['US 02'],['DIRECT'],['Japan 01','Hong Kong 01']]) {
    assert.throws(()=>buildQuantumultX({...source,'proxy-groups':[
      source['proxy-groups'][0],{name:'ASMR',type:'select',proxies}]},template,{expectedCount:5}),/asmr-candidates/);
  }
  const conflicting=template.replace('[server_local]', 'static = Futu,direct\nstatic = Futu,proxy\n[server_local]');
  assert.throws(()=>buildQuantumultX(source,conflicting,{expectedCount:5}),/duplicate-app-policy/);
  const unknown=template.replace('[server_local]', 'available = ASMR,direct\n[server_local]');
  assert.throws(()=>buildQuantumultX(source,unknown,{expectedCount:5}),/app-policy-type/);
  const collision={proxies:[node('Futu')],'proxy-groups':[{name:'Anthropic',proxies:['Futu']}]};
  assert.throws(()=>buildQuantumultX(collision,template,{expectedCount:1}),/policy-node-collision/);
});

test('generated public provider stays in sync and Caddy only exposes the two public rule resources', () => {
  const expected=buildQuantumultXAppRules();
  assert.equal(readFileSync(new URL('../caddy/quantumultx/Apps.list',import.meta.url),'utf8'),expected);
  assert.equal(expected.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).length,64);
  assert.ok(expected.indexOf('host-suffix,todesk.com,direct')<expected.indexOf('host-suffix,anthropic.com,Anthropic'));
  assert.ok(expected.indexOf('host-suffix,anthropic.com,Anthropic')<expected.indexOf('host-suffix,asmr.one,ASMR'));
  assert.ok(expected.indexOf('host-suffix,asmr.one,ASMR')<expected.indexOf('host-suffix,futunn.com,Futu'));
  const caddy=readFileSync(new URL('../caddy/QuantumultX.Caddyfile',import.meta.url),'utf8');
  assert.match(caddy,/@publicFilter path \/quantumultx\/Anthropic\.list \/quantumultx\/Apps\.list\n/);
  assert.match(caddy,/respond "Not Found" 404/);
});
