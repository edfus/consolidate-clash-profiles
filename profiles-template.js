export default [
  {
    url: "https://dler.cloud/subscribe/$dabrig?clash=trojan",
    map: yml => {
      return yml.proxies.filter(
        proxy => /5G/.test(proxy.name)
      ).map(
        proxy => {
          proxy.name = "Dler Cloud ".concat(proxy.name.trim());
          return proxy;
        }
      )
    }
  },
  "https://admin:9acdc7d8@zombo.com/config/clash.yml"
]