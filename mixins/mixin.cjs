const mixinYAML = `
mixin: # object
    hosts:
        dns.google: 8.8.8.8
        dns-unfiltered.adguard.com: 94.140.14.140
        sandbox.opendns.com: 208.67.222.2
        dns10.quad9.net: 9.9.9.10
        security-filter-dns.cleanbrowsing.org: 185.228.168.9
    dns:
        enable: true
        listen: 0.0.0.0:53
        enhanced-mode: fake-ip
        use-hosts: true
        nameserver:
            - https://1.1.1.1/dns-query
            - https://1.0.0.1/dns-query
            - https://dns.google
            - https://dns-unfiltered.adguard.com/dns-query
            - https://sandbox.opendns.com/dns-query
            - https://dns10.quad9.net/dns-query
            - https://security-filter-dns.cleanbrowsing.org/dns-query
        fallback-filter:
            geoip: false
        fake-ip-filter:
            # Microsoft Network Connectivity Status Indicator (NCSI)
            - "dns.msftncsi.com"
            - "www.msftncsi.com"
            - "www.msftconnecttest.com"
    interface-name: Ethernet
    tun:
        enable: true
        stack: gvisor
        auto-route: true
        # auto-detect-interface: true
        dns-hijack:
            - 198.18.0.2:53
`;

module.exports.parse = async (
  { content, name, url },
  { axios, yaml, notify }
) => {
  const loadedMixin = yaml.parse(mixinYAML);
  const extra = loadedMixin.mixin || loadedMixin;
  if (content.hosts && typeof content.hosts === "object") {
    for (const hostname in content.hosts) {
      extra[hostname] = content.hosts[hostname];
    }
  }

  if (content.dns?.enable && Array.isArray(content.dns.nameserver)) {
    for (const ns of content.dns.nameserver) {
      if (Array.isArray(extra.dns.nameserver)) {
        if (typeof ns === "string" && ns.startsWith("https://")) {
          if(!extra.dns.nameserver.includes(ns)) {
            extra.dns.nameserver.push(ns);
          }
        }
      }
    }
  }

  return { ...content, ...extra };
};