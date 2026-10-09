#!/usr/bin/env python3
"""Generate secrets locally; stdout contains no secret values."""
import argparse,json,secrets,re,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--endpoint',default='wss://47.95.2.2:8443');p.add_argument('--ssh-port',type=int,default=22222);p.add_argument('--name',default='kk');a=p.parse_args()
if not re.fullmatch(r'[a-z][a-z0-9-]{0,30}',a.name):p.error('invalid tunnel name')
out=Path(a.output).resolve()
if 'private' not in out.parts:p.error('output must be inside a private directory')
if not 1024<=a.ssh_port<=65535:p.error('invalid unprivileged SSH port')
if not re.fullmatch(r'wss://[a-zA-Z0-9.:-]+',a.endpoint):p.error('expected a wss endpoint without credentials or path')
if out.exists() and any(out.iterdir()):p.error('refusing to overwrite existing secrets')
os.umask(0o077);out.mkdir(parents=True,exist_ok=True);out.chmod(0o700)
path='ws-'+secrets.token_hex(24);token=secrets.token_hex(32)
files={
 'server-restrictions.yaml':f'''restrictions:
  - name: {a.name}-ssh-only
    match:
      - !PathPrefix "^{path}$"
      - !Authorization "^Bearer {token}$"
    allow:
      - !ReverseTunnel
        protocol: [Tcp]
        port: [{a.ssh_port}]
        cidr: [0.0.0.0/32]
''',
 'client.env':f'WSTUNNEL_HTTP_UPGRADE_PATH_PREFIX={path}\nRUST_LOG=off\n',
 'client-headers.txt':f'Authorization: Bearer {token}\n',
 'caddy.fragment':f'''\n @{a.name}_tunnel {{
  path /{path}/*
  header Upgrade websocket
 }}
 handle @{a.name}_tunnel {{
  reverse_proxy {a.name}-wstunnel-server:8080
 }}
''',
 'deployment.json':json.dumps({'endpoint':a.endpoint,'sshPort':a.ssh_port,'target':'127.0.0.1:22022','version':'11.0.0'},indent=2)+'\n',
}
for name,text in files.items():
 f=out/name;f.write_text(text);f.chmod(0o600)
print('Generated private path, independent bearer key and SSH-only restrictions. No secrets printed.')
