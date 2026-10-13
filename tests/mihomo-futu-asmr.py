"""Exercise candidate routing in a real Mihomo core, with localhost SOCKS recorders.
Usage: python3 tests/mihomo-futu-asmr.py /path/to/mihomo candidate-profile.json
No Futu credentials or destination traffic are used. This tests routing, not
remote node health or trading/login behavior.
"""
import json, queue, socket, ssl, struct, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path


def exact(sock, count):
    data = b''
    while len(data) < count:
        part = sock.recv(count - len(data))
        if not part:
            raise EOFError()
        data += part
    return data


def address(sock, kind):
    if kind == 1:
        return socket.inet_ntop(socket.AF_INET, exact(sock, 4))
    if kind == 4:
        return socket.inet_ntop(socket.AF_INET6, exact(sock, 16))
    return exact(sock, exact(sock, 1)[0]).decode()


def encode(host):
    try:
        return b'\x01' + socket.inet_pton(socket.AF_INET, host)
    except OSError:
        return bytes([3, len(host)]) + host.encode()


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


config = json.loads(Path(sys.argv[2]).read_text())
asmr = next(g for g in config['proxy-groups'] if g['name'] == 'ASMR')
assert asmr['proxies'] and asmr['proxies'] != ['REJECT']
seen, held = queue.Queue(), []
upstream = socket.socket()
upstream.bind(('127.0.0.1', 0))
upstream.listen()


def handle(sock):
    try:
        _, n = exact(sock, 2)
        exact(sock, n)
        sock.sendall(b'\x05\x00')
        _, _, _, kind = exact(sock, 4)
        host = address(sock, kind)
        dst = struct.unpack('!H', exact(sock, 2))[0]
        sock.sendall(b'\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00')
        seen.put((host, dst))
        held.append(sock)
    except Exception as error:
        print('recorder error: '+type(error).__name__, file=sys.stderr)
        sock.close()


def serve():
    while True:
        try:
            sock, _ = upstream.accept()
        except OSError:
            return
        threading.Thread(target=handle, args=(sock,), daemon=True).start()


threading.Thread(target=serve, daemon=True).start()
proxyport, apiport = port(), port()
api = f'http://127.0.0.1:{apiport}'


def request(path):
    with urllib.request.urlopen(api + path, timeout=2) as response:
        return json.load(response)


hosts = ['asmr.one', 'api.asmr.one', 'api.futunn.com', 'q.futunn.com',
         'futu.cn', 'cdn.futustatic.com', 'api.moomoobull.com', 'api.anthropic.com']
groups = [asmr, {'name': 'Proxy', 'type': 'select', 'proxies': ['fixture-proxy']},
          {'name': 'Anthropic', 'type': 'select', 'proxies': ['fixture-anthropic']}]
node_names = asmr['proxies'] + ['fixture-proxy', 'fixture-anthropic']
cfg = {'mixed-port': proxyport, 'bind-address': '127.0.0.1', 'allow-lan': False,
       'external-controller': f'127.0.0.1:{apiport}', 'mode': 'rule', 'log-level': 'debug',
       'dns': {'enable': True, 'nameserver': ['127.0.0.1:1'], 'use-hosts': True},
       'hosts': {host: '203.0.113.11' for host in hosts},
       'sniffer': config['sniffer'], 'find-process-mode': 'off',
       'proxies': [{'name': name, 'type': 'socks5', 'server': '127.0.0.1',
                    'port': upstream.getsockname()[1]} for name in node_names],
       'proxy-groups': groups,
       'rules': [r for r in config['rules'] if r.split(',')[0] in
                 ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'PROCESS-NAME', 'IP-CIDR', 'IP-CIDR6']
                 and r.split(',')[2] in ['ASMR', 'Proxy', 'Anthropic', 'DIRECT']] + ['MATCH,REJECT']}
with tempfile.TemporaryDirectory(prefix='mihomo-app-routing-') as tmp:
    path = Path(tmp) / 'config.json'
    path.write_text(json.dumps(cfg))
    check = subprocess.run([sys.argv[1], '-t', '-d', tmp, '-f', str(path)], capture_output=True)
    assert check.returncode == 0, 'Mihomo rejected offline test configuration'
    proc = subprocess.Popen([sys.argv[1], '-d', tmp, '-f', str(path)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    clients, results = [], []
    try:
        for _ in range(100):
            try:
                state = request('/proxies')['proxies']
                assert state['ASMR']['now'] == asmr['proxies'][0]
                assert state['Proxy']['now'] == 'fixture-proxy'
                time.sleep(.2)
                break
            except Exception:
                assert proc.poll() is None, 'Mihomo exited'
                time.sleep(.05)
        else:
            raise AssertionError('Mihomo startup timed out')

        def probe(host, policy, dst=80, sni=None, http_host=None):
            sock = socket.create_connection(('127.0.0.1', proxyport), timeout=3)
            sock.settimeout(3)
            clients.append(sock)
            sock.sendall(b'\x05\x01\x00')
            assert exact(sock, 2) == b'\x05\x00'
            sock.sendall(b'\x05\x01\x00' + encode(host) + struct.pack('!H', dst))
            reply = exact(sock, 4)
            if reply[1] != 0:
                assert policy == 'REJECT'
                results.append({'case': host, 'policy': policy})
                return
            assert reply[1] == 0
            address(sock, reply[3])
            exact(sock, 2)
            if sni:
                incoming, outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
                tls = ssl.create_default_context().wrap_bio(incoming, outgoing,
                      server_side=False, server_hostname=sni)
                try:
                    tls.do_handshake()
                except ssl.SSLWantReadError:
                    pass
                sock.sendall(outgoing.read())
            elif http_host:
                sock.sendall(f'GET / HTTP/1.1\r\nHost: {http_host}\r\n\r\n'.encode())
            else:
                sock.sendall(f'GET / HTTP/1.1\r\nHost: {host}\r\n\r\n'.encode())
            if policy == 'REJECT':
                try:
                    closed = sock.recv(1) == b''
                except ConnectionResetError:
                    closed = True
                assert closed, 'Rejected connection stayed open'
                assert seen.empty(), 'Rejected connection reached upstream'
                results.append({'case': host, 'policy': policy})
                return
            try:
                seen.get(timeout=5)
            except queue.Empty:
                raise AssertionError('No upstream connection for ' + host)
            matches = [c for c in request('/connections')['connections']
                       if c['metadata'].get('sourcePort') == str(sock.getsockname()[1])]
            assert len(matches) == 1
            conn = matches[0]
            assert policy in conn['chains'], 'Unexpected routing policy'
            if policy == 'ASMR':
                assert conn['chains'][0] == asmr['proxies'][0], 'ASMR initial node differs'
            results.append({'case': sni or http_host or host, 'policy': policy, 'rule': conn['rule']})

        for host in hosts:
            probe(host, 'ASMR' if host.endswith('asmr.one') else
                  'Anthropic' if host.endswith('anthropic.com') else 'Proxy')
        probe('203.0.113.20', 'Proxy', 443, sni='api.futunn.com')
        probe('203.0.113.21', 'ASMR', 80, http_host='asmr.one')
        probe('203.0.113.22', 'REJECT')
        probe('notasmr.one', 'REJECT')
        probe('futunn.com.example', 'REJECT')
        print(json.dumps({'mihomo': request('/version')['version'], 'passed': len(results),
                          'cases': results}, ensure_ascii=False))
    finally:
        for sock in clients + held:
            sock.close()
        upstream.close()
        proc.terminate()
        proc.wait(timeout=5)
