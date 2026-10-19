import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {buildCommunitySupplement,convertCommunityRule,parseFutuSection,parseSharedIM,
  validateFutuSupplement,fetchCommunitySources} from '../generators/quantumultx-futu-community.js';

const shared='DOMAIN-SUFFIX,shortconn.im.qcloud.com\nDOMAIN,shortconnv6.im.qcloud.com\nDOMAIN,loginv6.im.qcloud.com\n';
const primary='# Futu - core domains\nDOMAIN-SUFFIX,futunn.com\nDOMAIN-SUFFIX,futuapi.com\nDOMAIN,api.futuapi.com\n'
  +Array.from({length:48},(_,i)=>`DOMAIN-SUFFIX,fixture${i}.example`).join('\n')
  +'\nIP-CIDR,1.14.242.17/23,no-resolve\n# Longbridge - API endpoints\nDOMAIN-SUFFIX,lbkrs.com\nIP-CIDR,8.8.8.8/32,no-resolve\n';

test('community extraction stops at other brokers, canonicalizes networks and retains the curated endpoint',()=>{
  const text=buildCommunitySupplement(primary,shared,['DOMAIN-SUFFIX,futunn.com','PROCESS-NAME,FTNN']);
  assert.ok(text.includes('host-suffix,futuapi.com,Futu\n'));
  assert.ok(!text.includes('host,api.futuapi.com'));
  assert.ok(!text.includes('host-suffix,futunn.com'));
  assert.ok(text.includes('ip-cidr,1.14.242.0/23,Futu,no-resolve'));
  assert.ok(text.includes('ip-cidr,43.162.222.168/32,Futu,no-resolve'));
  assert.ok(text.includes('host,loginv6.im.qcloud.com,Futu'));
  assert.doesNotMatch(text,/lbkrs\.com|8\.8\.8\.8|PROCESS-NAME/);
  assert.equal(new Set(validateFutuSupplement(text)).size,validateFutuSupplement(text).length);
});

test('changed boundaries, excessively broad ranges, local IPs and unsupported syntax require review',()=>{
  for(const text of [primary.replace('# Futu - core domains','# Other'),primary.replace('# Longbridge','# Unknown'),'# Futu - core domains\n# Longbridge']) {
    assert.throws(()=>parseFutuSection(text));
  }
  for(const line of ['IP-CIDR,0.0.0.0/0,no-resolve','IP-CIDR,43.132.0.0/16,no-resolve',
    'IP-CIDR,127.0.0.1/32,no-resolve','IP-CIDR,198.18.0.0/24,no-resolve',
    'IP-CIDR,10.0.0.0/23,no-resolve','IP-CIDR,999.1.1.1/32,no-resolve',
    'IP-CIDR,43.132.106.6/32','DOMAIN-KEYWORD,futu','DOMAIN-SUFFIX,com','DOMAIN,https://example.com',
    'DOMAIN,futu.com,DIRECT','IP-CIDR6,::/0,no-resolve'])assert.throws(()=>convertCommunityRule(line),line);
  assert.throws(()=>parseSharedIM(shared.replace('loginv6.im.qcloud.com','other.im.qcloud.com')));
  assert.throws(()=>validateFutuSupplement('ip-cidr,1.14.242.17/23,Futu,no-resolve'));
  assert.throws(()=>validateFutuSupplement('host,futu.com,direct'));
});

test('source retrieval uses immutable file revisions and rejects download, metadata and license failures',async()=>{
  const calls=[];
  const fake=async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'error');assert.ok(!options.headers.Authorization);
    let text;
    if(url.includes('/commits?'))text=JSON.stringify([{sha:'a'.repeat(40),commit:{committer:{date:'2026-10-01T00:00:00Z'}}}]);
    else {assert.ok(url.includes('/'+'a'.repeat(40)+'/'));text=url.endsWith('/LICENSE')?'MIT License\nCopyright fixture':url.endsWith('/HK_Broker.list')?primary:shared;}
    return {ok:true,text:async()=>text};
  };
  const sources=await fetchCommunitySources(fake);
  assert.equal(sources.length,2);assert.equal(calls.length,5);
  assert.ok(sources.every(s=>s.revision==='a'.repeat(40)));
  await assert.rejects(fetchCommunitySources(async()=>({ok:false})),/download failed/);
  await assert.rejects(fetchCommunitySources(async()=>({ok:true,text:async()=>'[{"sha":"main"}]'})),/Invalid source revision/);
  await assert.rejects(fetchCommunitySources(async(url,options)=>url.endsWith('/LICENSE')?{ok:true,text:async()=>'Unknown terms'}:fake(url,options)),/license changed/);
});

test('reviewed supplement fingerprint, source pins and shared-dependency scope remain explicit',()=>{
  const data=readFileSync(new URL('../rules/QuantumultX-Futu-Community.list',import.meta.url),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('../rules/QuantumultX-Futu-Community.sources.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(data).digest('hex'),manifest.rulesSHA256);
  const baseline=readFileSync(new URL('../rules/Futu.yml',import.meta.url));
  assert.equal(createHash('sha256').update(baseline).digest('hex'),manifest.baselineSHA256);
  assert.equal(manifest.deviceVerifiedAt,null);
  assert.ok(manifest.sources.every(s=>/^[0-9a-f]{40}$/.test(s.revision)&&s.url.includes(s.revision)));
  const rules=validateFutuSupplement(data);
  assert.equal(rules.filter(l=>l.startsWith('host')).length,9);
  assert.equal(rules.filter(l=>l.startsWith('ip-cidr,')).length,64);
  for(const domain of ['futuapi.com','futuin.com','qtlcdn.com','loginv6.im.qcloud.com'])assert.ok(rules.some(l=>l.split(',')[1]===domain));
  assert.ok(rules.every(l=>!l.includes('lbkrs.com')&&!l.includes('itiger.com')&&!l.includes('schwab.com')));
  assert.ok(!load(baseline).payload.some(l=>l.startsWith('IP-CIDR,')),'Shared Clash input stays unchanged');
});
