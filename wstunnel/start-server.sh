#!/bin/sh
set -eu
name=${WSTUNNEL_NAME:-kk}
case "$name" in ''|*[!a-z0-9-]*) echo "Invalid tunnel name" >&2; exit 2;; esac
secret_dir=$(cd "$1" && pwd)
port=${2:-22222}
case "$port" in ''|*[!0-9]*) exit 2;; esac
[ -f "$secret_dir/server-restrictions.yaml" ]
docker run -d --name ${name}-wstunnel-server --restart unless-stopped --network caddy \
 --read-only --security-opt no-new-privileges:true --log-driver none \
 -p "${WSTUNNEL_BIND_IP:-0.0.0.0}:$port:$port/tcp" -v "$secret_dir:/config:ro" -e RUST_LOG=off \
 local/wstunnel:11.0.0 server ws://0.0.0.0:8080 --restrict-config /config/server-restrictions.yaml
