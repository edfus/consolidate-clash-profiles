import { isIPv4, BlockList } from 'node:net';

export const communitySources = [
  { key: 'futu', repo: 'LingJingMaster/Shadowrocket-Rules', path: 'HK_Broker.list' },
  { key: 'sharedIM', repo: 'forecho/broker-rules', path: 'Source/broker/_shared.conf' },
];
export const curatedFutuHosts = ['ip-cidr,43.162.222.168/32,Futu,no-resolve'];
export const curatedSource = 'https://github.com/blackmatrix7/ios_rule_script/issues/1687#issuecomment-4772080950';
const sharedIM = new Set(['shortconn.im.qcloud.com', 'shortconnv6.im.qcloud.com', 'loginv6.im.qcloud.com']);
const specialIPs = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',3]]) {
  specialIPs.addSubnet(ip,prefix);
}
const lines = text => text.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
const number = ip => ip.split('.').reduce((n,p)=>n*256+Number(p),0);
const address = n => [24,16,8,0].map(s=>(n>>>s)&255).join('.');

export function convertCommunityRule(line) {
  const [type,value,...options]=line.split(',');
  if (type==='IP-CIDR') {
    const [ip,prefix,...extra]=value.split('/');
    if (!isIPv4(ip)||extra.length||!['23','24','32'].includes(prefix)||options.join(',')!=='no-resolve') {
      throw new Error('Community CIDR requires review: only IPv4 /23, /24 and /32 are accepted');
    }
    const size=2**(32-Number(prefix)),network=Math.floor(number(ip)/size)*size;
    if (specialIPs.check(address(network))||specialIPs.check(address(network+size-1))) throw new Error('Non-public community IP rejected');
    return `ip-cidr,${address(network)}/${prefix},Futu,no-resolve`;
  }
  if (!['DOMAIN','DOMAIN-SUFFIX'].includes(type)||options.length||!value
    ||value!==value.toLowerCase()||value.split('.').length<2
    ||!value.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) {
    throw new Error('Unsupported community domain rule');
  }
  return `${type==='DOMAIN'?'host':'host-suffix'},${value},Futu`;
}

export function parseFutuSection(text) {
  const start=/^# Futu - core domains\s*$/m.exec(text);
  const end=/^# Longbridge\b/m.exec(text);
  if (!start||!end||end.index<=start.index) throw new Error('Futu source boundaries changed; review required');
  const rules=lines(text.slice(start.index,end.index)).map(convertCommunityRule);
  if (rules.length<50||rules.length>300||!rules.includes('host-suffix,futunn.com,Futu')) throw new Error('Unexpected Futu source scope');
  return rules;
}

export function parseSharedIM(text) {
  const rules=lines(text).filter(l=>sharedIM.has(l.split(',')[1])).map(convertCommunityRule);
  if (new Set(rules.map(l=>l.split(',')[1])).size!==sharedIM.size) throw new Error('Shared IM source changed; review required');
  return rules;
}

export function validateFutuSupplement(text) {
  return lines(text).map(line=>{
    const [type,value,policy,...options]=line.split(',');
    const names={host:'DOMAIN','host-suffix':'DOMAIN-SUFFIX','ip-cidr':'IP-CIDR'};
    if (policy!=='Futu'||!names[type]) throw new Error('Invalid QX Futu policy or rule');
    const canonical=convertCommunityRule([names[type],value,...options].join(','));
    if (canonical!==line) throw new Error('Noncanonical QX Futu rule');
    return line;
  });
}

export function buildCommunitySupplement(primary,shared,baseline) {
  const existing=baseline.filter(l=>!l.startsWith('PROCESS-NAME,')).map(convertCommunityRule);
  const allDomains=[...existing],extra=[];
  for (const rule of [...parseFutuSection(primary),...parseSharedIM(shared),...curatedFutuHosts]) {
    if (existing.includes(rule)||extra.includes(rule)) continue;
    const [type,value]=rule.split(',');
    if (type!=='ip-cidr') {
      if (allDomains.some(l=>{
        const [t,v]=l.split(',');return t==='host-suffix'&&(value===v||value.endsWith('.'+v));
      })) continue;
      allDomains.push(rule);
    }
    extra.push(rule);
  }
  // Domains remain ahead of address fallbacks so shared-host traffic retains
  // explicit ToDesk/Anthropic/ASMR classifications in the complete app block.
  const ordered=extra.filter(l=>!l.startsWith('ip-cidr,')).concat(extra.filter(l=>l.startsWith('ip-cidr,')));
  const text='# Quantumult X Futu community supplement; generated, do not edit.\n'
    +'# Refresh: node scripts/refresh-quantumultx-futu.mjs --check / --update\n'
    +'# Provenance: rules/QuantumultX-Futu-Community.sources.json\n'
    +'# Shared cloud ranges and IM endpoints can also affect other applications.\n'
    +ordered.join('\n')+'\n';
  validateFutuSupplement(text);
  return text;
}

export async function fetchCommunitySources(fetchImpl=fetch) {
  const get=async url=>{
    const r=await fetchImpl(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'qx-futu-rule-review'},
      redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error('Community source download failed');
    const text=await r.text();if(text.length>500000)throw new Error('Community source exceeds size limit');return text;
  };
  return Promise.all(communitySources.map(async source=>{
    const commits=JSON.parse(await get(`https://api.github.com/repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`));
    const c=commits[0];
    if (!/^[a-f0-9]{40}$/.test(c?.sha)||!Number.isFinite(Date.parse(c?.commit?.committer?.date))) throw new Error('Invalid source revision');
    const url=`https://raw.githubusercontent.com/${source.repo}/${c.sha}/${source.path}`;
    const text=await get(url);
    const license=source.key==='futu'?await get(`https://raw.githubusercontent.com/${source.repo}/${c.sha}/LICENSE`):undefined;
    if (license&&!license.includes('MIT License'))throw new Error('Community license changed; review required');
    return {...source,revision:c.sha,fileCommittedAt:c.commit.committer.date,url,text,license};
  }));
}
