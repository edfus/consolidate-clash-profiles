#!/bin/sh
set -eu
secret_dir=$(cd "$1" && pwd)
endpoint=${2:-wss://47.95.2.2:8443}
port=${3:-22222}
case "$port" in ''|*[!0-9]*) exit 2;; esac
[ -f "$secret_dir/client-headers.txt" ]
docker run -d --name kk-wstunnel-client --restart unless-stopped --network host \
 --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges:true --log-driver none \
 --env-file "$secret_dir/client.env" -v "$secret_dir:/config:ro" \
 -v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro \
 -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
 local/wstunnel:11.0.0 client --tls-verify-certificate --http-headers-file /config/client-headers.txt \
 --remote-to-local "tcp://0.0.0.0:$port:127.0.0.1:22" "$endpoint"
