// Deliberately small, fail-closed subset; see docs/quantumultx-support.txt.
import { isIP } from 'node:net';

const COMMON = ['name', 'type', 'server', 'port', 'password', 'udp', 'tfo'];
const TLS = ['network', 'sni', 'alpn', 'skip-cert-verify'];
const CIPHERS = new Set(['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']);
class ConversionError extends Error {
  constructor(code) {
    super(`Quantumult X conversion rejected: ${code}`);
    this.code = code;
  }
}
function fail(code) { throw new ConversionError(code); }
function scalar(value) {
  // No escaping convention assumed: reject separators rather than corrupt secrets.
  if (typeof value !== 'string' || !value || value !== value.trim() || /[,;#\r\n\x00-\x1f\x7f]/u.test(value)) fail('unsafe-value');
  return value;
}
function boolean(value) {
  if (typeof value !== 'boolean') fail('invalid-boolean');
  return value;
}
function endpoint(server, port) {
  scalar(server);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('invalid-port');
  if (!isIP(server) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(server)) fail('invalid-server');
  return `${isIP(server) === 6 ? `[${server}]` : server}:${port}`;
}
function alpnHex(protocols) {
  if (!Array.isArray(protocols) || !protocols.length) fail('invalid-alpn');
  return protocols.map(p => {
    if (typeof p !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(p)) fail('invalid-alpn');
    const bytes = Buffer.from(p, 'ascii');
    return bytes.length.toString(16).padStart(2, '0') + bytes.toString('hex');
  }).join('');
}

export function convertQuantumultXNode(node, { anytls = false, allowInsecureSourceTLS = false } = {}) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('invalid-node');
  if (!['ss', 'trojan', 'anytls'].includes(node.type)) fail('unsupported-protocol');
  if (node.type === 'anytls' && anytls !== true) fail('anytls-requires-qx-1.6.0');
  const allowed = new Set([...COMMON, ...(node.type === 'ss' ? ['cipher', 'plugin', 'plugin-opts'] : TLS)]);
  // Do not echo unknown keys or values: either may contain private information.
  if (Object.keys(node).some(k => !allowed.has(k))) fail('unsupported-field');
  const parts = [`${node.type === 'ss' ? 'shadowsocks' : node.type}=${endpoint(node.server, node.port)}`];
  if (node.type === 'ss') {
    if (!CIPHERS.has(node.cipher)) fail('unsupported-cipher');
    parts.push(`method=${node.cipher}`);
    if (node.plugin !== undefined) {
      if (node.plugin !== 'obfs') fail('unsupported-plugin');
      const opts = node['plugin-opts'];
      if (!opts || typeof opts !== 'object' || Array.isArray(opts) ||
          Object.keys(opts).some(k => !['mode', 'host'].includes(k))) fail('unsupported-plugin-options');
      if (!['http', 'tls'].includes(opts.mode)) fail('unsupported-obfs-mode');
      parts.push(`obfs=${opts.mode}`);
      if (opts.host !== undefined) parts.push(`obfs-host=${scalar(opts.host)}`);
    } else if (node['plugin-opts'] !== undefined) fail('plugin-options-without-plugin');
  }
  parts.push(`password=${scalar(node.password)}`);
  if (node.type !== 'ss') {
    if (node.network !== undefined && node.network !== 'tcp') fail('unsupported-transport');
    const skipVerify = node['skip-cert-verify'] === undefined ? false : boolean(node['skip-cert-verify']);
    if (skipVerify && allowInsecureSourceTLS !== true) fail('insecure-tls-not-enabled');
    parts.push('over-tls=true', `tls-verification=${!skipVerify}`);
    if (node.sni !== undefined) parts.push(`tls-host=${scalar(node.sni)}`);
    if (node.alpn !== undefined) parts.push(`tls-alpn=${alpnHex(node.alpn)}`);
  }
  parts.push(`udp-relay=${node.udp === undefined ? false : boolean(node.udp)}`);
  if (node.type === 'ss') parts.push('udp-over-tcp=false');
  if (node.tfo !== undefined) parts.push(`fast-open=${boolean(node.tfo)}`);
  parts.push(`tag=${scalar(node.name)}`);
  return parts.join(', ');
}

// Inspection returns counts and fixed reason codes only, never connection secrets.
// Indices are zero-based and refer to the input array; unknown type strings are masked.
export function inspectQuantumultXNodes(nodes, options) {
  if (!Array.isArray(nodes) || !nodes.length) fail('empty-or-invalid-nodes');
  const report = { total: nodes.length, accepted: 0, rejected: 0, insecureSourceTLS: 0, byType: {}, failures: [] };
  const names = new Set();
  nodes.forEach((node, index) => {
    const type = ['ss', 'trojan', 'anytls', 'vmess', 'vless', 'hysteria2', 'tuic', 'wireguard'].includes(node?.type)
      ? node.type : 'unknown';
    report.byType[type] ??= { total: 0, accepted: 0, rejected: 0 };
    report.byType[type].total++;
    if (node?.['skip-cert-verify'] === true) report.insecureSourceTLS++;
    try {
      convertQuantumultXNode(node, options);
      if (names.has(node.name)) fail('duplicate-tag');
      names.add(node.name);
      report.accepted++;
      report.byType[type].accepted++;
    } catch (error) {
      report.rejected++;
      report.byType[type].rejected++;
      report.failures.push({ index, type, code: error instanceof ConversionError ? error.code : 'invalid-node' });
    }
  });
  return report;
}

// Atomic conversion: callers receive no partial subscription if one node fails.
// Return value contains secrets. Never log it or write it into tracked/public paths.
export function convertQuantumultXNodes(nodes, options) {
  const report = inspectQuantumultXNodes(nodes, options);
  if (report.rejected) {
    const error = new ConversionError('batch-rejected');
    error.report = report;
    throw error;
  }
  return nodes.map(node => convertQuantumultXNode(node, options)).join('\n') + '\n';
}
