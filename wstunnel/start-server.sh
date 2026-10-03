#!/bin/sh
set -eu
secret_dir=$(cd "$1" && pwd)
port=${2:-22222}
case "$port" in ''|*[!0-9]*) exit 2;; esac
[ -f "$secret_dir/server-restrictions.yaml" ]
docker run -d --name kk-wstunnel-server --restart unless-stopped --network caddy \
 --read-only --security-opt no-new-privileges:true --log-driver none \
 -p "$port:$port/tcp" -v "$secret_dir:/config:ro" -e RUST_LOG=off \
 local/wstunnel:11.0.0 server ws://0.0.0.0:8080 --restrict-config /config/server-restrictions.yaml
