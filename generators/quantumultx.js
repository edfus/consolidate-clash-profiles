import { readFileSync } from 'node:fs';
import { convertQuantumultXNodes } from '../converters/quantumultx.js';
import { buildQuantumultXAppRules } from './quantumultx-app-rules.js';

// Full configuration and server list are PRIVATE outputs. Never log either.
export function buildQuantumultX(source, template, options = {}) {
  const fail = code => { throw new Error(`Quantumult X generation rejected: ${code}`); };
  if (!source || !Array.isArray(source.proxies)) fail('invalid-source');
  const expected = options.expectedCount;
  if (!Number.isInteger(expected) || expected <= 0 || source.proxies.length !== expected) fail('node-count');
  if (typeof template !== 'string') fail('invalid-template');
  const servers = convertQuantumultXNodes(source.proxies, options);
  const names = new Set(source.proxies.map(p => p.name));
  const groups = source['proxy-groups']?.filter(g => g.name === 'Anthropic');
  if (groups?.length !== 1 || !Array.isArray(groups[0].proxies) || !groups[0].proxies.length) fail('anthropic-group');
  const candidates = groups[0].proxies;
  if (candidates.some(n => !names.has(n)) || new Set(candidates).size !== candidates.length) fail('anthropic-candidates');
  const sections = new Map();
  const normalized = template.replace(/\r\n/g, '\n');
  const matches = [...normalized.matchAll(/^\[([^\]\n]+)\][ \t]*\n/gm)];
  if (!matches.length || normalized.slice(0, matches[0].index).trim()) fail('invalid-sections');
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1];
    if (sections.has(key)) fail('duplicate-section');
    sections.set(key, normalized.slice(matches[i].index + matches[i][0].length, matches[i + 1]?.index));
  }
  for (const key of ['server_local','server_remote','policy','filter_local','filter_remote']) if (!sections.has(key)) fail('missing-section');
  // Prevent appending another subscription and silently exceeding the verified count.
  const active = text => text.split('\n').filter(l => l.trim() && !/^\s*(?:#|;|\/\/)/.test(l));
  if (active(sections.get('server_remote')).length) fail('remote-servers-not-empty');
  sections.set('server_local', servers + '\n');
  let policy = sections.get('policy');
  for (const name of ['Anthropic','AI Suite']) {
    const pattern = new RegExp(`^static\\s*=\\s*${name},.*$`, 'gm');
    if ([...policy.matchAll(pattern)].length !== 1) fail('policy-definition');
    const values = name === 'Anthropic' ? candidates.join(',') : [...names].join(',');
    policy = policy.replace(pattern, () => `static = ${name},${values}`);
  }
  const hk = /香港|Hong[ ._-]*Kong|(?:^|[^a-z])HK(?:[^a-z]|$)|🇭🇰/i;
  const jp = /日本|东京|東京|大阪|Japan|Tokyo|Osaka|(?:^|[^a-z])JP(?:[^a-z]|$)|🇯🇵/i;
  const regional = source.proxies.filter(p => hk.test(p.name))
    .concat(source.proxies.filter(p => !hk.test(p.name) && jp.test(p.name))).map(p => p.name);
  const sourceASMR = source['proxy-groups']?.filter(g => g.name === 'ASMR') || [];
  if (sourceASMR.length > 1 || (sourceASMR.length &&
    (sourceASMR[0].type !== 'select' || JSON.stringify(sourceASMR[0].proxies)
      !== JSON.stringify(regional.length ? regional : ['REJECT'])))) fail('asmr-candidates');
  const asmr = regional.length ? regional : ['reject'];
  for (const [name, values] of [['ASMR', asmr], ['Futu', ['proxy', ...names]]]) {
    const definitions = policy.split('\n').filter(line => {
      if (!line.trim() || /^\s*(?:#|;|\/\/)/.test(line)) return false;
      return line.split('=')[1]?.split(',')[0].trim() === name;
    });
    if (definitions.length > 1) fail('duplicate-app-policy');
    if (definitions.length && !/^\s*static\s*=/.test(definitions[0])) fail('app-policy-type');
    const definition = `static = ${name},${values.join(',')}`;
    policy = definitions.length ? policy.replace(definitions[0], () => definition)
      : policy + (policy.endsWith('\n') ? '' : '\n') + definition + '\n';
  }
  const policyNames = new Set(policy.split('\n').filter(line => line.trim()
    && !/^\s*(?:#|;|\/\/)/.test(line)).map(line => line.split('=')[1]?.split(',')[0].trim()));
  if ([...names].some(name => policyNames.has(name) || ['proxy','direct','reject'].includes(name))) fail('policy-node-collision');
  sections.set('policy', policy);
  // Dedicated remote resource takes priority over the existing shared AI filter.
  const filterURL = 'https://47.95.2.2:8443/quantumultx/Anthropic.list';
  const remote = sections.get('filter_remote').split('\n').filter(l => !l.startsWith(filterURL + ',')).join('\n');
  sections.set('filter_remote', `${filterURL},tag=Anthropic,force-policy=Anthropic,inserted-resource=true,update-interval=43200,enabled=true\n${remote}`);
  // Explicit candidates work for embedded server_local nodes, without relying on
  // remote-resource regex discovery. Embed AI rules so a CDN fetch failure does
  // not leave AI requests using a broad regional/default policy.
  const aiRules = readFileSync(new URL('../rules/QuantumultX-AI.list', import.meta.url), 'utf8').trim();
  const local = sections.get('filter_local').replace(/# BEGIN MANAGED AI SUITE\n[\s\S]*?# END MANAGED AI SUITE\n?/g, '');
  sections.set('filter_local', `# BEGIN MANAGED AI SUITE\n${aiRules}\n# END MANAGED AI SUITE\n${local}`);
  // Inserted remote resources precede local rules in QX. Put a complete public
  // priority block before existing resources without changing their settings.
  const appsURL = 'https://47.95.2.2:8443/quantumultx/Apps.list';
  const existingRemote = sections.get('filter_remote').split('\n')
    .filter(line => line.split(',')[0].trim() !== appsURL).join('\n');
  sections.set('filter_remote', `${appsURL},tag=App Routing,inserted-resource=true,update-interval=43200,enabled=true\n${existingRemote}`);
  const appRules = buildQuantumultXAppRules();
  const existingLocal = sections.get('filter_local')
    .replace(/# BEGIN MANAGED APP ROUTING\n[\s\S]*?# END MANAGED APP ROUTING\n?/g, '');
  sections.set('filter_local', `# BEGIN MANAGED APP ROUTING\n${appRules}# END MANAGED APP ROUTING\n${existingLocal}`);
  // Keep embedded Anthropic rules as a fallback if remote refresh is unavailable.
  const config = [...sections].map(([key, value]) => `[${key}]\n${value}`).join('');
  return { servers, config, summary: {
    sourceCount: source.proxies.length, outputCount: servers.trim().split('\n').length,
    anthropicCandidates: candidates.length,
    asmrCandidates: regional.length,
    futuCandidates: names.size,
    futuDomainRules: appRules.split('\n').filter(line => line.endsWith(',Futu')).length,
    futuIPRules: appRules.split('\n').filter(line => /^ip-cidr,[^,]+,Futu,no-resolve$/.test(line)).length,
    omittedFutuProcessRules: 4,
    protocols: source.proxies.reduce((a,n) => { a[n.type] = (a[n.type] || 0) + 1; return a; }, {}),
    sourceInsecureTLS: source.proxies.filter(n => n['skip-cert-verify'] === true).length,
  }};
}
