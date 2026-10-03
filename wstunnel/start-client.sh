#!/bin/sh
set -eu
secret_dir=$(cd "$1" && pwd)
endpoint=${2:-wss://47.95.2.2:8443}
port=${3:-22222}
case "$port" in ''|*[!0-9]*) exit 2;; esac
[ -f "$secret_dir/client-headers.txt" ]
# Refuse to expose a password-capable or missing SSH configuration.
sshd_config="$HOME/.config/kk-tunnel-sshd/sshd_config"
effective=$(/usr/sbin/sshd -T -f "$sshd_config")
printf '%s\n' "$effective" | grep -qx 'authenticationmethods publickey'
printf '%s\n' "$effective" | grep -qx 'passwordauthentication no'
printf '%s\n' "$effective" | grep -qx 'kbdinteractiveauthentication no'
printf '%s\n' "$effective" | grep -qx 'listenaddress 127.0.0.1:22022'
if [ "${WSTUNNEL_CREATE_ONLY:-0}" = 1 ]; then
  set -- create
else
  set -- run -d
fi
docker "$@" --name kk-wstunnel-client --restart unless-stopped --network host \
 --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges:true --log-driver none \
 --env-file "$secret_dir/client.env" -v "$secret_dir:/config:ro" \
 -v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro \
 -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
 local/wstunnel:11.0.0 client --tls-verify-certificate --http-headers-file /config/client-headers.txt \
 --remote-to-local "tcp://0.0.0.0:$port:127.0.0.1:22022" "$endpoint"
