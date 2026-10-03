#!/bin/sh
set -eu
# Run on Linux x86_64. Fetch only the pinned upstream official release.
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'Linux x86_64 required' >&2; exit 1; }
version=11.0.0
archive="wstunnel_${version}_linux_amd64.tar.gz"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl -fsSL "https://github.com/erebe/wstunnel/releases/download/v$version/checksums.txt" -o "$work/checksums.txt"
curl -fsSL "https://github.com/erebe/wstunnel/releases/download/v$version/$archive" -o "$work/$archive"
(cd "$work" && awk -v name="$archive" '$2 == name {print}' checksums.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256 && tar -xzf "$archive" wstunnel)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -m 755 "$work/wstunnel" "$script_dir/wstunnel"
printf 'FROM scratch\nCOPY wstunnel /wstunnel\nENTRYPOINT ["/wstunnel"]\n' > "$work/Dockerfile"
docker build -t local/wstunnel:11.0.0 "$work"
