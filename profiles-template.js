export default [
  "https://admin:9acdc7d8@zombo.com/config/clash.yml",  
  {
    url: "https://clash:122h2347QfdvCc12w2@xx.xx//clash.yml",
    nameservers: false,
    hosts: false,
  },
  {
    url: "https://dler.cloud/subscribe/$dabrig?clash=trojan",
    map: yml => {
      const getCountryNames = new Intl.DisplayNames(['en'], {type: 'region'});
      const cityMaps = {
        "费城": "Philadelphia",
        "纽约": "NYC",
        "硅谷": "Silicon Valley",
        "丹佛": "Denver",
        "洛杉矶": "L.A.",
        "圣何塞": "San Jose",
        "斯波坎": "Spokane WA",
        "奥格登": "Ogden UT",
        "凤凰城": "Phoenix",
        "西雅图": "Seattle",
        "芝加哥": "Chicago",
        "达拉斯": "Dallas",
        "底特律": "Detroit",
        "夏威夷": "Hawaii",
        "密尔沃基": "Milwaukee WI",
        "圣克拉拉": "Santa Clara CA",
        "柯汶纳": "Covina CA",
      };
      return yml.proxies.filter(
        proxy => /家宽|US/.test(proxy.name)
      ).map(
        proxy => {
          const countryCodeMatch = proxy.name.match(/(?<=\s)[A-Z]{2}\s*$/);
          const countryCode = countryCodeMatch?.[0] || "";
          const countryName = getCountryNames.of(countryCode);
          proxy.name = "[TAG] ".concat(
            proxy.name
              .replace(/家宽/g, " Residential")
              .replace(
                /^([\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF] [^\s\-]+)(\s|-)([^丨]+)/, 
                (match, country, seperator, cityOrSupplementary) => {
                  if (countryName) {
                    if (countryCode != "US") {
                      return `${countryName}${seperator}${cityOrSupplementary}`;
                    } else {
                      for (const city in cityMaps) {
                        if (cityOrSupplementary.startsWith(city)) {
                          return cityOrSupplementary.replace(city, cityMaps[city]);
                        }
                      }
                      return `U.S. ${cityOrSupplementary}`;
                    }
                  } else {
                    return match;
                  }
                }
              )
              .replace(/(?<=\s)[A-Z]{2}\s*$/, "")
              .replace(/丨/g, " ")
              .trim()
          );
          return proxy;
        }
      )
    }
  },
  {
    url: "https://clash:vN5yhfghnx@xxx/.config/clash.yml",
    map: yml => {
      // yml.proxies.push(load(
      //   `
      //   - name: "Hys-xxx"
      //     type: hysteria
      //     server: xxx
      //     port: 50416
      //     auth_str: Hysteria
      //     alpn: h3
      //     protocol: wechat-video
      //     up: 31
      //     down: 31
      //     sni: xxx
      //     skip-cert-verify: false
      //     recv_window_conn: 31345728
      //     recv_window: 123582912
      //     disable_mtu_discovery: true
      //   `)[0])
       
      return yml.proxies;
    }
  },
]