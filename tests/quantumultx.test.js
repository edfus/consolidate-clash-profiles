import test from 'node:test';
import assert from 'node:assert/strict';
import { convertQuantumultXNode as convert, convertQuantumultXNodes as batch, inspectQuantumultXNodes as inspect } from '../converters/quantumultx.js';
const base = { name: 'Fixture', type: 'trojan', server: 'example.com', port: 443, password: 'fixture-only' };

test('Trojan preserves TLS validation, SNI, ALPN and UDP settings', () => {
  assert.equal(convert({ ...base, sni: 'tls.example.com', alpn: ['h2', 'http/1.1'], udp: true, tfo: false }),
    'trojan=example.com:443, password=fixture-only, over-tls=true, tls-verification=true, tls-host=tls.example.com, tls-alpn=02683208687474702f312e31, udp-relay=true, fast-open=false, tag=Fixture');
});
test('AnyTLS requires explicitly confirmed client capability', () => {
  assert.throws(() => convert({ ...base, type: 'anytls' }), /requires-qx-1.6.0/);
  assert.match(convert({ ...base, type: 'anytls' }, { anytls: true }), /^anytls=.*over-tls=true/);
});
test('plain AEAD Shadowsocks and IPv6 serialize without TLS assumptions', () => {
  assert.equal(convert({ ...base, type: 'ss', cipher: 'aes-128-gcm', server: '2001:db8::1', udp: false }),
    'shadowsocks=[2001:db8::1]:443, method=aes-128-gcm, password=fixture-only, udp-relay=false, udp-over-tcp=false, tag=Fixture');
});
test('unknown protocols, transport and TLS semantics fail closed', () => {
  for (const extra of [
    { type: 'hysteria2' }, { type: 'tuic' }, { network: 'grpc' }, { network: 'ws' },
    { 'reality-opts': {} }, { 'client-fingerprint': 'chrome' }, { 'dialer-proxy': 'Other' },
    { 'idle-session-timeout': 30 }, { 'skip-cert-verify': true }, { udp: 'true' },
  ]) assert.throws(() => convert({ ...base, ...extra }));
  assert.throws(() => convert({ ...base, type: 'ss', cipher: 'unknown' }));
  assert.throws(() => convert({ ...base, type: 'ss', cipher: 'aes-128-gcm', plugin: 'obfs' }));
});
test('delimiter injection and invalid endpoints cannot generate configuration', () => {
  for (const field of ['name', 'password', 'sni', 'server']) {
    for (const value of ['bad, tag=injected', 'bad\n[policy]', ' bad', 'bad#comment'])
      assert.throws(() => convert({ ...base, [field]: value }));
  }
  for (const port of [0, 65536, '443', NaN]) assert.throws(() => convert({ ...base, port }));
});
test('errors never disclose node values or unknown field names', () => {
  assert.throws(() => convert({ ...base, 'private-token-field': 'secret-example' }), error =>
    !/private-token|secret-example|example.com|Fixture/.test(error.message));
});
test('batch rejects duplicates, empty lists and unsupported nodes atomically', () => {
  assert.throws(() => batch([]));
  assert.throws(() => batch([base, base]), e => e.report.failures[0].code === 'duplicate-tag');
  assert.throws(() => batch([base, { ...base, name: 'Other', type: 'wireguard' }]));
  assert.equal(batch([base]), convert(base) + '\n');
});

test('inspection accounts for every node and never exposes unknown type values', () => {
  const nodes = [base, { ...base, type: 'private-protocol-secret' }, { ...base, name: 'Other', network: 'grpc' }];
  const report = inspect(nodes);
  assert.equal(report.total, 3);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 2);
  assert.deepEqual(report.failures, [
    { index: 1, type: 'unknown', code: 'unsupported-protocol' },
    { index: 2, type: 'trojan', code: 'unsupported-transport' },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /private-protocol-secret|example.com|fixture-only|Other/);
  assert.throws(() => batch(nodes), e => e.report.total === 3 && e.report.rejected === 2);
});

test('Shadowsocks simple-obfs maps only audited mode and host fields', () => {
  const node = { ...base, type: 'ss', cipher: 'aes-128-gcm', plugin: 'obfs',
    'plugin-opts': { mode: 'http', host: 'cover.example.com' }, udp: true };
  assert.equal(convert(node), 'shadowsocks=example.com:443, method=aes-128-gcm, obfs=http, obfs-host=cover.example.com, password=fixture-only, udp-relay=true, udp-over-tcp=false, tag=Fixture');
  assert.match(convert({ ...node, 'plugin-opts': { mode: 'tls', host: 'cover.example.com' } }), /obfs=tls/);
  for (const opts of [{ mode: 'http', extra: true }, { mode: 'ws' }, null, ['http']])
    assert.throws(() => convert({ ...node, 'plugin-opts': opts }));
  assert.throws(() => convert({ ...node, plugin: undefined }));
});
test('existing insecure node TLS requires explicit permission and cannot disable secure nodes', () => {
  const node = { ...base, type: 'anytls', 'skip-cert-verify': true };
  assert.throws(() => convert(node, { anytls: true }), /insecure-tls-not-enabled/);
  const options = { anytls: true, allowInsecureSourceTLS: true };
  assert.match(convert(node, options), /tls-verification=false/);
  assert.match(convert({ ...node, 'skip-cert-verify': false }, options), /tls-verification=true/);
  assert.match(convert(base, options), /tls-verification=true/);
  assert.equal(inspect([node], options).insecureSourceTLS, 1);
});
test('140 synthetic nodes remain 140, with insecure source nodes blocked unless explicitly allowed', () => {
  const nodes = [
    ...Array.from({ length: 90 }, (_, i) => ({ ...base, name: `SS fixture ${i}`, type: 'ss', cipher: 'aes-128-gcm', plugin: 'obfs', 'plugin-opts': { mode: 'http', host: 'cover.example.com' }, udp: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ ...base, name: `Trojan fixture ${i}`, alpn: ['h2', 'http/1.1'], udp: true })),
    ...Array.from({ length: 42 }, (_, i) => ({ ...base, name: `AnyTLS fixture ${i}`, type: 'anytls', sni: 'tls.example.com', 'skip-cert-verify': true, tfo: false, udp: true })),
  ];
  const report = inspect(nodes, { anytls: true });
  assert.equal(report.total, 140);
  assert.equal(report.accepted, 98);
  assert.equal(report.rejected, 42);
  assert.equal(report.insecureSourceTLS, 42);
  assert.throws(() => batch(nodes, { anytls: true }));
  const output = batch(nodes, { anytls: true, allowInsecureSourceTLS: true });
  assert.equal(output.trim().split('\n').length, 140);
  assert.equal(output.match(/tls-verification=false/g).length, 42);
});
