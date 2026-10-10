#!/bin/sh
set -eu
# Fetch the pinned upstream release for this Linux architecture.
[ "$(uname -s)" = Linux ] || { echo 'Linux required' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo 'Unsupported architecture' >&2; exit 1 ;;
esac
version=11.0.0
archive="wstunnel_${version}_linux_${arch}.tar.gz"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl -fsSL "https://github.com/erebe/wstunnel/releases/download/v$version/checksums.txt" -o "$work/checksums.txt"
curl -fsSL "https://github.com/erebe/wstunnel/releases/download/v$version/$archive" -o "$work/$archive"
(cd "$work" && awk -v name="$archive" '$2 == name {print}' checksums.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256 && tar -xzf "$archive" wstunnel)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -m 755 "$work/wstunnel" "$script_dir/wstunnel"
printf 'FROM scratch\nCOPY wstunnel /wstunnel\nENTRYPOINT ["/wstunnel"]\n' > "$work/Dockerfile"
chmod 755 "$work/wstunnel"
docker build -t local/wstunnel:11.0.0 "$work"
