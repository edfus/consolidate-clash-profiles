#!/bin/sh
set -eu
name=${WSTUNNEL_NAME:-kk}
case "$name" in ''|*[!a-z0-9-]*) echo "Invalid tunnel name" >&2; exit 2;; esac
# A separate unprivileged sshd, restricted to the current account.
base="$HOME/.config/${name}-tunnel-sshd"
mkdir -p "$base"
chmod 700 "$base"
umask 077
authorized_keys=${WSTUNNEL_AUTHORIZED_KEYS:-$HOME/.ssh/authorized_keys}
[ -s "$authorized_keys" ] || { echo 'authorized_keys is required' >&2; exit 1; }
[ -f "$base/host_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -f "$base/host_ed25519"
cat > "$base/sshd_config" <<CONFIG
ListenAddress 127.0.0.1
Port 22022
HostKey $base/host_ed25519
PidFile $base/sshd.pid
AuthorizedKeysFile $authorized_keys
AllowUsers $(id -un)
PubkeyAuthentication yes
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin no
UsePAM no
StrictModes yes
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
AllowStreamLocalForwarding no
PermitTunnel no
LoginGraceTime 20
MaxAuthTries 3
MaxStartups 10:30:30
Subsystem sftp internal-sftp
CONFIG
/usr/sbin/sshd -t -f "$base/sshd_config"
if [ -f "$base/sshd.pid" ] && kill -0 "$(cat "$base/sshd.pid")" 2>/dev/null; then
    echo 'Existing instance found; configuration validated, restart it explicitly to apply changes.'
else
    /usr/sbin/sshd -f "$base/sshd_config" -E "$base/sshd.log"
fi
printf 'Independent public-key-only sshd listening on 127.0.0.1:22022\n'
# Install a single user-owned boot entry; preserve other cron jobs.
cronfile=$(mktemp)
trap 'rm -f "$cronfile"' EXIT HUP INT TERM
(crontab -l 2>/dev/null || true) | grep -v "# ${name}-tunnel-sshd\$" > "$cronfile" || true
printf '@reboot /usr/sbin/sshd -f "%s/sshd_config" -E "%s/sshd.log" # %s-tunnel-sshd\n' "$base" "$base" "$name" >> "$cronfile"
crontab "$cronfile"
