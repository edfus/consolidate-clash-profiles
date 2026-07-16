
mkdir -p /root && cd /root && export REPO=Compose-Trojan-Caddy && git clone --depth 1 "https://github.com/edfus/$REPO" C && cd C && chmod +x index.sh && ./index.sh -h

cd /root/C && chmod +x * && ./index.sh up -c