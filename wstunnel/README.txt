kk SSH through a VPS WebSocket reverse tunnel

Topology
SSH client -> VPS TCP 22222 -> wstunnel reverse tunnel -> kk 127.0.0.1:22
kk initiates verified WSS to the existing Caddy HTTPS listener on port 8443.
The VPS Caddy forwards only a generated path with WebSocket Upgrade to the
wstunnel server on Docker network caddy. Backend port 8080 is not published.
SSH retains kk authentication and its original host key.

Install
Use Linux x86_64 with Docker. Run install.sh on both hosts. It verifies the
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
Run start-client.sh PRIVATE_DIRECTORY [WSS_ENDPOINT] [SSH_PORT] on kk.
Ensure cloud and host firewalls allow the intended TCP 22222 and WSS listener.
The scripts expect Docker network caddy on the VPS and a trusted HTTPS
certificate matching the client endpoint. TLS verification is explicitly on.
Do not enable access/debug logs containing private paths or authorization.

Authentication and limits
The random path and independent bearer key must BOTH match. Restrictions
permit only TCP reverse binding 0.0.0.0:22222 by default; other reverse ports
and forward tunnels are denied. The public SSH port uses kk SSH credentials.
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
