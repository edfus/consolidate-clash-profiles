const mixinYAML = `
mixin: # object
  hosts:
    sandbox.opendns.com: 208.67.222.2
    dns10.quad9.net: 9.9.9.10
  dns:
    enable: true
    listen: 0.0.0.0:53
    enhanced-mode: fake-ip
    use-hosts: true
    nameserver:
      - https://sandbox.opendns.com/dns-query
      - https://dns10.quad9.net/dns-query
    fallback-filter:
      geoip: false
  interface-name: Ethernet
  tun:
    enable: true
    stack: system
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
    const nameservers = (
      Array.isArray(content.dns.fallback)
      ? content.dns.fallback
      : content.dns.nameserver
    );

    for (const ns of nameservers) {
      if (typeof ns === "string" && ns.startsWith("https://")) {
        if(Array.isArray(content.dns.fallback)) {
          if(!extra.dns.fallback.includes(ns)) {
            extra.dns.fallback.push(ns);
          }
        } else {
          if(!Array.isArray(extra.dns.nameserver)) {
            extra.dns.nameserver = [];
          }

          if(!extra.dns.nameserver.includes(ns)) {
            extra.dns.nameserver.push(ns);
          }
        }
      }
    }
  }

  return { ...content, ...extra };
};