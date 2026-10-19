import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {buildCommunitySupplement,fetchCommunitySources,curatedSource} from '../generators/quantumultx-futu-community.js';
import {buildQuantumultXAppRules} from '../generators/quantumultx-app-rules.js';

const flags=process.argv.slice(2),update=flags.includes('--update');
if(flags.length>1||flags.some(f=>!['--check','--update'].includes(f))){
  console.error('Usage: refresh-quantumultx-futu.mjs [--check | --update]');process.exit(2);
}
const root=new URL('../',import.meta.url),path=name=>new URL(name,root);
const hash=text=>createHash('sha256').update(text).digest('hex');
try{
  const sources=await fetchCommunitySources();
  const baseline=load(readFileSync(path('rules/Futu.yml'),'utf8')).payload;
  const text=buildCommunitySupplement(sources.find(s=>s.key==='futu').text,sources.find(s=>s.key==='sharedIM').text,baseline);
  const target=path('rules/QuantumultX-Futu-Community.list');
  const before=existsSync(target)?readFileSync(target,'utf8'):'';
  const active=t=>t.split('\n').filter(l=>l&&!l.startsWith('#'));
  const added=active(text).filter(l=>!active(before).includes(l));
  const removed=active(before).filter(l=>!active(text).includes(l));
  const manifest={schemaVersion:1,checkedAt:new Date().toISOString(),deviceVerifiedAt:null,
    note:'Source/file dates and download checks do not prove current endpoint ownership, health or trading success.',
    policy:'QX only; community Futu section plus three audited shared IM endpoints; IPv4 /23, /24, /32 only; review before publishing.',
    sources:sources.map(({text,license,...s})=>({...s,sha256:hash(text),...(license?{license:'MIT',licenseSHA256:hash(license)}:{})})),
    curated:[{rule:'ip-cidr,43.162.222.168/32,Futu,no-resolve',source:curatedSource,reportedAt:'2026-06-22'}],
    rulesSHA256:hash(text),baselineSHA256:hash(readFileSync(path('rules/Futu.yml')))};
  if(update){
    const licensePath=path('rules/licenses/QuantumultX-Futu-LingJingMaster-MIT.txt');
    mkdirSync(new URL('./',licensePath),{recursive:true});
    const writes=[[target,text],[path('rules/QuantumultX-Futu-Community.sources.json'),JSON.stringify(manifest,null,2)+'\n'],
      [licensePath,sources.find(s=>s.key==='futu').license],
      [path('caddy/quantumultx/Apps.list'),buildQuantumultXAppRules({futuSupplement:text})]];
    const saved=writes.map(([p])=>existsSync(p)?readFileSync(p):null);
    try{
      for(const [p,content]of writes)writeFileSync(new URL(p.href+'.tmp'),content,{mode:0o644});
      for(const [p]of writes)renameSync(new URL(p.href+'.tmp'),p);
    }catch(error){
      for(let i=0;i<writes.length;i++){
        const p=writes[i][0];if(saved[i]===null){if(existsSync(p))unlinkSync(p);}else writeFileSync(p,saved[i]);
        const tmp=new URL(p.href+'.tmp');if(existsSync(tmp))unlinkSync(tmp);
      }throw error;
    }
  }
  console.log(JSON.stringify({status:update?'local-candidate-updated':added.length||removed.length?'update-available':'up-to-date',
    added:added.length,removed:removed.length,domainRules:active(text).filter(l=>l.startsWith('host')).length,
    ipRules:active(text).filter(l=>l.startsWith('ip-cidr,')).length,checkedAt:manifest.checkedAt,
    sourceRevisions:manifest.sources.map(s=>({repo:s.repo,path:s.path,revision:s.revision,fileCommittedAt:s.fileCommittedAt})),
    rulesSHA256:manifest.rulesSHA256,productionModified:false,reviewRequired:true}));
}catch{console.error('Community refresh failed; existing local snapshots and production are unchanged.');process.exitCode=1;}
