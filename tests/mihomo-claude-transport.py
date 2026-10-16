"""Offline checks against a generated profile and a real Mihomo binary.

Usage: python3 tests/mihomo-claude-transport.py /path/to/mihomo profile.json
All proxy destinations terminate at a local SOCKS recorder. DNS upstream is a
closed loopback port. This checks Fake-IP and UDP rejection, not remote health
or operating-system TUN capture.
"""
import ipaddress
import json
import queue
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path


def exact(s, n):
    result = b''
    while len(result) < n:
        chunk = s.recv(n - len(result))
        if not chunk:
            raise EOFError()
        result += chunk
    return result


def address(s, kind):
    if kind == 1:
        return socket.inet_ntop(socket.AF_INET, exact(s, 4))
    if kind == 4:
        return socket.inet_ntop(socket.AF_INET6, exact(s, 16))
    return exact(s, exact(s, 1)[0]).decode()


def encode(host):
    try:
        ip = ipaddress.ip_address(host)
        return bytes([1 if ip.version == 4 else 4]) + ip.packed
    except ValueError:
        return bytes([3, len(host)]) + host.encode()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


config = json.loads(Path(sys.argv[2]).read_text())
reject = 'AND,((NETWORK,UDP),(DST-PORT,443)),REJECT'
assert config['rules'][0] == reject
domains = ['claude.ai', 'claude.com', 'anthropic.com']
assert config['sniffer']['force-domain'] == ['+.' + h for h in domains]
assert config['dns']['enhanced-mode'] == 'fake-ip'
assert config.get('tun', {}).get('stack') in [None, 'system']
seen = queue.Queue()
held = []
tcp = socket.socket()
tcp.bind(('127.0.0.1', 0))
tcp.listen()
udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp.bind(('127.0.0.1', 0))


def handle(s):
    try:
        version, count = exact(s, 2)
        exact(s, count)
        s.sendall(b'\x05\x00')
        version, cmd, reserved, kind = exact(s, 4)
        host, dst = address(s, kind), struct.unpack('!H', exact(s, 2))[0]
        assert cmd == 3, 'Unexpected TCP destination'
        s.sendall(b'\x05\x00\x00\x01\x7f\x00\x00\x01' + struct.pack('!H', udp.getsockname()[1]))
        held.append(s)
    except Exception:
        s.close()


def accept():
    while True:
        try:
            s, _ = tcp.accept()
        except OSError:
            return
        threading.Thread(target=handle, args=(s,), daemon=True).start()


def record():
    while True:
        try:
            packet, _ = udp.recvfrom(65535)
        except OSError:
            return
        seen.put(packet)


threading.Thread(target=accept, daemon=True).start()
threading.Thread(target=record, daemon=True).start()
mixed, api, dns = free_port(), free_port(), free_port()
cfg = {'mixed-port': mixed, 'allow-lan': False, 'bind-address': '127.0.0.1',
       'external-controller': f'127.0.0.1:{api}', 'mode': 'rule', 'log-level': 'debug',
       'find-process-mode': 'off', 'sniffer': config['sniffer'],
       'hosts': {h: '203.0.113.11' for h in ['futunn.com', 'example.cn', 'todesk.com']},
       'dns': {'enable': True, 'listen': f'127.0.0.1:{dns}',
               'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
               'fake-ip-filter': [x for x in config['dns']['fake-ip-filter']
                                  if not x.startswith(('geosite:', 'rule-set:'))],
               'nameserver': ['127.0.0.1:1']},
       'proxies': [{'name': 'Recorder', 'type': 'socks5', 'server': '127.0.0.1',
                    'port': tcp.getsockname()[1], 'udp': True}],
       'proxy-groups': [{'name': 'Anthropic', 'type': 'select', 'proxies': ['Recorder']}],
       # Preserve the generated ban and competing domain rules; all successful
       # traffic terminates locally, including the UDP 9000 positive control.
       'rules': [reject, 'DOMAIN-SUFFIX,todesk.com,DIRECT'] +
                [r for r in config['rules'] if len(r.split(',')) > 2 and
                 r.split(',')[2] == 'Anthropic' and not r.startswith('PROCESS-')] +
                ['MATCH,Recorder']}

with tempfile.TemporaryDirectory(prefix='mihomo-claude-transport-') as tmp:
    path = Path(tmp) / 'config.json'
    path.write_text(json.dumps(cfg))
    logpath = Path(tmp) / 'mihomo.log'
    with logpath.open('w') as log:
        proc = subprocess.Popen([sys.argv[1], '-d', tmp, '-f', str(path)], stdout=log, stderr=log)
        control = None
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{api}/version', timeout=.5) as r:
                        version = json.load(r)
                    break
                except Exception:
                    assert proc.poll() is None, 'Mihomo exited'
                    time.sleep(.05)
            else:
                raise AssertionError('Mihomo startup timed out')

            dns_domains = domains + ['api.' + h for h in domains]
            for host in dns_domains:
                question = b''.join(bytes([len(p)]) + p.encode() for p in host.split('.')) + b'\x00\x00\x01\x00\x01'
                query = b'\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00' + question
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                    client.settimeout(3)
                    client.sendto(query, ('127.0.0.1', dns))
                    reply, _ = client.recvfrom(4096)
                assert reply[:2] == b'\x12\x34' and reply[3] & 15 == 0
                assert struct.unpack('!H', reply[6:8])[0] == 1
                assert ipaddress.ip_address(reply[-4:]) in ipaddress.ip_network('198.18.0.0/16'), host

            control = socket.create_connection(('127.0.0.1', mixed), timeout=3)
            control.sendall(b'\x05\x01\x00')
            assert exact(control, 2) == b'\x05\x00'
            control.sendall(b'\x05\x03\x00\x01\x00\x00\x00\x00\x00\x00')
            response = exact(control, 4)
            assert response[1] == 0
            relay = (address(control, response[3]), struct.unpack('!H', exact(control, 2))[0])
            assert relay[0] in ['127.0.0.1', '0.0.0.0'], relay
            relay = ('127.0.0.1', relay[1])
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.sendto(b'\x00\x00\x00' + encode('203.0.113.10') + struct.pack('!H', 9000) + b'control', relay)
                assert seen.get(timeout=3).endswith(b'control'), 'Initial UDP positive control failed'
            targets = ['203.0.113.10', 'claude.ai', 'api.anthropic.com', 'futunn.com', 'example.cn',
                       'todesk.com', '160.79.104.10',
                       '2607:6bc0::10', '2001:db8::10']
            for host in targets:
                before = logpath.read_text().count('using REJECT')
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                    client.sendto(b'\x00\x00\x00' + encode(host) + struct.pack('!H', 443) + b'probe', relay)
                    for _ in range(100):
                        if logpath.read_text().count('using REJECT') > before:
                            break
                        time.sleep(.03)
                    else:
                        raise AssertionError('UDP 443 did not hit REJECT: ' + host)
                assert seen.empty(), 'Rejected packet reached outbound recorder'
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.sendto(b'\x00\x00\x00' + encode('203.0.113.10') + struct.pack('!H', 9000) + b'control', relay)
                assert seen.get(timeout=3).endswith(b'control'), 'UDP positive control failed'
            print(json.dumps({'mihomo': version, 'fakeIPDomains': len(dns_domains),
                              'udp443Rejected': len(targets), 'udp9000Allowed': True,
                              'externalDestinationTraffic': False}))
        except Exception:
            print(logpath.read_text(), file=sys.stderr)
            raise
        finally:
            if control:
                control.close()
            for s in held:
                s.close()
            tcp.close()
            udp.close()
            proc.terminate()
            proc.wait(timeout=5)
