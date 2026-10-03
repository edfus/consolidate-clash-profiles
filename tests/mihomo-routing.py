"""Offline Mihomo routing test. No destination traffic leaves localhost.
Usage: python3 tests/mihomo-routing.py /path/to/mihomo generated-profile.json
Uses the generated Anthropic rules, sniffer and group; replaces nodes with local
SOCKS recorders and rejects unrelated traffic. Does not test remote node health.
"""
import ipaddress,json,queue,socket,ssl,struct,subprocess,sys,tempfile,threading,time,urllib.request
from pathlib import Path

def exact(s,n):
    b=b''
    while len(b)<n:
        chunk=s.recv(n-len(b))
        if not chunk: raise EOFError()
        b+=chunk
    return b

def address(s,kind):
    if kind==1:return socket.inet_ntop(socket.AF_INET,exact(s,4))
    if kind==4:return socket.inet_ntop(socket.AF_INET6,exact(s,16))
    return exact(s,exact(s,1)[0]).decode()

def encode(host):
    try:
        ip=ipaddress.ip_address(host)
        return bytes([1 if ip.version==4 else 4])+ip.packed
    except ValueError:return bytes([3,len(host)])+host.encode()

def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

config=json.loads(Path(sys.argv[2]).read_text())
group=next(g for g in config['proxy-groups'] if g['name']=='Anthropic')
assert group['proxies']==['[TAG] L.A. 02 1x','[TAG] L.A. 06 1x'],group
seen=queue.Queue(); held=[]
upstream=socket.socket();upstream.bind(('127.0.0.1',0));upstream.listen()

def handle(s):
    try:
        version,n=exact(s,2);exact(s,n);s.sendall(b'\x05\x00')
        version,cmd,res,kind=exact(s,4);host=address(s,kind);dst=struct.unpack('!H',exact(s,2))[0]
        s.sendall(b'\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00');seen.put((host,dst));held.append(s)
    except Exception:s.close()
def serve():
    while True:
        try:s,_=upstream.accept()
        except OSError:return
        threading.Thread(target=handle,args=(s,),daemon=True).start()
threading.Thread(target=serve,daemon=True).start()
proxyport,apiport=port(),port()
api=f'http://127.0.0.1:{apiport}'
def request(path,body=None):
    req=urllib.request.Request(api+path,data=None if body is None else json.dumps(body).encode(),
        method='GET' if body is None else 'PUT',headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=2) as r:
        data=r.read();return json.loads(data) if data else None

cfg={'mixed-port':proxyport,'bind-address':'127.0.0.1','allow-lan':False,
 'external-controller':f'127.0.0.1:{apiport}','mode':'rule','log-level':'debug',
 'dns':{'enable':True,'nameserver':['127.0.0.1:1'],'use-hosts':True},
 'hosts':{h:'203.0.113.11' for h in ['api.anthropic.com','claude.ai','http-intake.logs.us5.datadoghq.com','statsig.anthropic.com','cdn.growthbook.io']},'sniffer':config['sniffer'],'find-process-mode':'off',
 'proxies':[{'name':name,'type':'socks5','server':'127.0.0.1','port':upstream.getsockname()[1]}
            for name in group['proxies']], 'proxy-groups':[group],
 'rules':[r for r in config['rules'] if len(r.split(','))>2 and r.split(',')[2]=='Anthropic']+['MATCH,REJECT']}
with tempfile.TemporaryDirectory(prefix='mihomo-routing-') as tmp:
    f=Path(tmp)/'config.json';f.write_text(json.dumps(cfg));log=open(Path(tmp)/'mihomo.log','w+')
    check=subprocess.run([sys.argv[1],'-t','-d',tmp,'-f',str(f)],capture_output=True,text=True)
    assert check.returncode==0,check.stdout+check.stderr
    proc=subprocess.Popen([sys.argv[1],'-d',tmp,'-f',str(f)],stdout=log,stderr=log)
    clients=[];results=[]
    try:
        for _ in range(100):
            try:request('/version');break
            except Exception:
                assert proc.poll() is None,'Mihomo exited';time.sleep(.05)
        else:raise AssertionError('Mihomo startup timed out')
        def probe(host,dst=9000,sni=None,http_host=None,expected='DomainSuffix'):
            s=socket.create_connection(('127.0.0.1',proxyport),timeout=3);s.settimeout(3);clients.append(s)
            s.sendall(b'\x05\x01\x00');assert exact(s,2)==b'\x05\x00'
            s.sendall(b'\x05\x01\x00'+encode(host)+struct.pack('!H',dst))
            reply=exact(s,4);assert reply[1]==0,reply;address(s,reply[3]);exact(s,2)
            if sni:
                incoming,outgoing=ssl.MemoryBIO(),ssl.MemoryBIO()
                tls=ssl.create_default_context().wrap_bio(incoming,outgoing,server_side=False,server_hostname=sni)
                try:tls.do_handshake()
                except ssl.SSLWantReadError:pass
                s.sendall(outgoing.read())
            elif http_host:s.sendall(f'GET / HTTP/1.1\r\nHost: {http_host}\r\n\r\n'.encode())
            else:s.sendall(b'routing-test'*32)
            routed=seen.get(timeout=5)
            matches=[c for c in request('/connections')['connections'] if c['metadata'].get('sourcePort')==str(s.getsockname()[1])]
            assert len(matches)==1,matches
            c=matches[0];assert 'Anthropic' in c['chains'],c
            assert c['rule']==expected,(c['rule'],expected)
            results.append({'host':sni or http_host or host,'rule':c['rule'],'chain':c['chains']})
        probe('api.anthropic.com')
        probe('160.79.104.10',expected='IPCIDR')
        probe('160.79.105.254',expected='IPCIDR')
        probe('2607:6bc0::10',expected='IPCIDR')
        probe('http-intake.logs.us5.datadoghq.com',expected='Domain')
        probe('1.1.1.1',443,sni='statsig.anthropic.com')
        probe('203.0.113.10',80,http_host='cdn.growthbook.io',expected='Domain')
        from urllib.parse import quote
        request('/proxies/'+quote('Anthropic'),{'name':group['proxies'][1]})
        probe('claude.ai')
        assert results[-1]['chain'][0]==group['proxies'][1],results[-1]
        print(json.dumps({'mihomo':request('/version'),'passed':len(results),'probes':results},ensure_ascii=False,indent=2))
    except Exception:
        log.flush();log.seek(0);print(log.read(),file=sys.stderr);raise
    finally:
        for s in clients+held:s.close()
        upstream.close();proc.terminate();proc.wait(timeout=5);log.close()
