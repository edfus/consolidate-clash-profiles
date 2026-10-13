import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuantumultX } from '../generators/quantumultx.js';
const node = { name:'Example', type:'trojan', server:'example.com', port:443, password:'synthetic-only' };
const source = { proxies:[node], 'proxy-groups':[{name:'Anthropic', proxies:['Example']}] };
const template = '[policy]\nstatic = Anthropic,Outside\nstatic = AI Suite,Outside\n\n[server_local]\n\n[server_remote]\n\n[filter_remote]\nhttps://example.com/ai.list,tag=AI Suite\n\n[filter_local]\nhost-suffix,anthropic.com,Anthropic\nfinal,Others\n';
test('build preserves node count, independent groups and prioritizes dedicated filter', () => {
 const result=buildQuantumultX(source,template,{expectedCount:1});
 assert.equal(result.summary.outputCount,1);
 assert.match(result.config,/static = Anthropic,Example/);
 assert.match(result.config,/static = AI Suite,Example/);
 assert.doesNotMatch(result.config,/static = AI Suite,server-tag-regex/);
 assert.match(result.config,/HOST-SUFFIX,oaistatic.com,AI Suite/);
 assert.match(result.config,/HOST-SUFFIX,openai.com,AI Suite/);
 assert.match(result.config,/inserted-resource=true/);
 assert.match(result.config,/host-suffix,anthropic.com,Anthropic/);
 assert.match(result.config,/final,Others/);
 assert.ok(result.config.includes(result.servers));
});
test('count mismatch, missing group targets and duplicate/extra subscriptions fail', () => {
 assert.throws(()=>buildQuantumultX(source,template,{expectedCount:140}),/node-count/);
 assert.throws(()=>buildQuantumultX({...source,'proxy-groups':[{name:'Anthropic',proxies:['Missing']}]},template,{expectedCount:1}),/anthropic-candidates/);
 assert.throws(()=>buildQuantumultX(source,template+'[server_local]\n',{expectedCount:1}),/duplicate-section/);
 assert.throws(()=>buildQuantumultX(source,template.replace('[server_remote]\n','[server_remote]\nhttps://example.com/nodes\n'),{expectedCount:1}),/remote-servers-not-empty/);
});

test('AI Suite explicitly lists every embedded node and stays independent of Anthropic', () => {
 const nodes=Array.from({length:140},(_,i)=>({...node,name:`Fixture ${i}`}));
 const result=buildQuantumultX({proxies:nodes,'proxy-groups':[{name:'Anthropic',proxies:['Fixture 2','Fixture 6']}]},template,{expectedCount:140});
 const policy=result.config.split('\n').find(l=>l.startsWith('static = AI Suite,'));
 assert.deepEqual(policy.split(',').slice(1),nodes.map(n=>n.name));
 assert.match(result.config,/static = Anthropic,Fixture 2,Fixture 6\n/);
});
