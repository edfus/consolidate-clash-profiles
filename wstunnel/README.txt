kk SSH through a VPS WebSocket reverse tunnel

Topology
SSH client -> VPS TCP 22222 -> wstunnel reverse tunnel -> kk 127.0.0.1:22022
kk initiates verified WSS to the existing Caddy HTTPS listener on port 8443.
The VPS Caddy forwards only a generated path with WebSocket Upgrade to the
wstunnel server on Docker network caddy. Backend port 8080 is not published.
SSH uses a dedicated host key and requires an authorized public key.

Install
Use Linux x86_64 or ARM64 with Docker. Run install.sh on both hosts. It verifies the
pinned official v11.0.0 release checksum and builds local/wstunnel:11.0.0.
Generate once from the repository root:
  python3 wstunnel/generate-private.py --output private/wstunnel-kk
The directory is ignored by Git. Keep its mode 0700 and files 0600.
Transfer server-restrictions.yaml and caddy.fragment privately to the VPS.
Transfer client.env and client-headers.txt privately to kk.
Run start-server.sh PRIVATE_DIRECTORY [SSH_PORT] on the VPS.
Insert caddy.fragment in the existing HTTPS site's routing block, before
its catch-all handler. Preserve existing subscription routes and credentials.
Validate the actual Caddy configuration and reload using its existing service.
First run install-sshd-user.sh as the kk login user. This creates an independent
loopback-only sshd on 22022, with password and keyboard-interactive auth disabled,
allows only the current account, and installs a user crontab @reboot entry.
It uses ~/.ssh/authorized_keys and does not alter the original SSH port 22.
Verify successful key login and that the only offered authentication is publickey.
Run start-client.sh PRIVATE_DIRECTORY [WSS_ENDPOINT] [SSH_PORT] on kk.
Ensure cloud and host firewalls allow the intended TCP 22222 and WSS listener.
The scripts expect Docker network caddy on the VPS and a trusted HTTPS
certificate matching the client endpoint. TLS verification is explicitly on.
Do not enable access/debug logs containing private paths or authorization.

Authentication and limits
The random path and independent bearer key must BOTH match. Restrictions
permit only TCP reverse binding 0.0.0.0:22222 by default; other reverse ports
and forward tunnels are denied. The public SSH port requires kk authorized SSH keys.
The bearer credential authenticates the tunnel; encryption is provided by TLS.
Containers restart unless stopped; Docker must be enabled at boot.
VPS server retains default Docker capabilities because dropping all capabilities
caused exit 139 on the deployed host. Both containers use a read-only filesystem
and no-new-privileges; kk client also drops capabilities and runs as its owner.

Operations
Rotate by generating a new empty private directory, securely replacing both
sides' files and the Caddy fragment, validating, reloading and recreating the
containers. Generation refuses to overwrite existing secrets. Never commit
actual paths, tokens, node subscriptions, CA keys or private SSH keys.
Rollback: restore the pre-change Caddy configuration, validate and reload;
then docker rm -f kk-wstunnel-client on kk and kk-wstunnel-server on VPS.
No RDP server is installed by this deployment.

References
https://github.com/erebe/wstunnel
https://github.com/erebe/wstunnel/blob/main/restrictions.yaml
https://robberphex.com/how-to-build-tunnel-over-websocket/

Dedicated sshd rollback: stop the PID in ~/.config/kk-tunnel-sshd/sshd.pid
(after verifying it belongs to this instance), and remove only the user crontab
line ending in # kk-tunnel-sshd. Leave the original system sshd untouched.

Multiple independent machines
Generate with --name hello --ssh-port 22223 and a separate private directory.
Set WSTUNNEL_NAME=hello for install-sshd-user.sh, start-client.sh and
start-server.sh. Names must contain only lowercase letters, digits and hyphens.
Set WSTUNNEL_AUTHORIZED_KEYS to a dedicated authorized_keys file before
installing the sshd, so this public entry accepts a separately revocable key.
WSTUNNEL_BIND_IP=127.0.0.1 on start-server.sh keeps the published reverse
port private during review. After successful end-to-end key authentication,
password rejection and tunnel restriction tests, recreate only that server
with WSTUNNEL_BIND_IP=0.0.0.0 to publish its chosen TCP port.
WSTUNNEL_CREATE_ONLY=1 creates the client without starting it.

Security review for hello deployment (2026-10-09)
The independent sshd binds only 127.0.0.1:22022 and allows only hello using a
new dedicated Ed25519 key. Password, keyboard-interactive, empty password,
root login, SSH TCP/socket/agent/X11 forwarding and tunnel devices are disabled.
The client validates the VPS TLS certificate. The server requires an independent
random path AND bearer credential, allowing only TCP reverse port 22223.
The backend WebSocket port 8080 is internal to Docker; existing RDP/NFS ports
on hello are not forwarded. The VPS port is initially loopback-only for review.
Unauthenticated callers can still scan or consume resources on a public SSH
port. MaxStartups/MaxAuthTries/LoginGraceTime limit pre-authentication work;
they do not prevent network denial of service. Source IP filtering, if needed,
belongs on the VPS because hello sees the reverse tunnel as a loopback client.
A successful login grants the existing hello account's privileges (including
Docker membership). Disabling SSH forwarding does not sandbox a shell user.
A stolen unencrypted client key grants this access: protect the transfer package,
and revoke by removing its public key from the dedicated authorized_keys file.

AGX-2 deployment (2026-10-10)
Uses WSTUNNEL_NAME=agx-2, VPS TCP 22224, WSS 47.95.2.2:8443,
and local dedicated sshd 127.0.0.1:22022 for user lzl. A separately generated
key is authorized only in ~/.config/agx-2-tunnel-sshd/authorized_keys.
ARM64 uses the verified upstream linux_arm64 asset. The install script sets
binary mode 0755 before building the image so a non-root container can execute it.
The same key-only, no-root, no-forwarding, strict TLS and separate tunnel token
restrictions used for hello apply. Public ports can be scanned and keys grant
the account's existing privileges, including Docker group membership.
