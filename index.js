import { load } from 'js-yaml';
import { promises as fsp } from 'fs';
import { fetchProfile } from "./fetch.js";

async function parseProfile(profile) {
  profile = typeof profile === "object" ? profile : {
    url: profile,
    map: p => p.proxies || [],
    nameservers: true
  };

  if (!profile.map) {
    profile.map = p => p.proxies || [];
  }

  
  if (!profile.hasOwnProperty("nameservers")) {
    profile.nameservers = true;
  }

  const response = await fetchProfile(profile.url);
  const userInfo = response.headers["subscription-userinfo"];
  const content = load(response.payload);

  const proxies = profile.map(content);
  if (!Array.isArray(proxies)) {
    throw new TypeError(
      `${response.url}: malformed map function: expected returned value to be of type Array`
    );
  }

  if (userInfo) {
    const userInfoObj = userInfo.split(/;\s*/).reduce(
      (acc, str) => {
        const [key, value] = str.split("=");
        acc[key.trim()] = value;
        return acc;
      }, {}
    );

    if (userInfoObj["expire"]) {
      const remainDays = (
        parseInt(userInfoObj["expire"]) - Date.now() / 1000
      ) / (60 * 60 * 24);

      if (remainDays < 16) {
        proxies.forEach(
          proxy => {
            proxy.name += ` [Expire in ${remainDays.toFixed(0)} days]`;
            return proxy;
          }
        );
      }
    }

    const usedBandwidth = (
      (parseInt(userInfoObj["upload"]) || 0)
      + parseInt(userInfoObj["download"])
    );

    if (usedBandwidth && userInfoObj["total"]) {
      const quota = parseInt(userInfoObj["total"]);

      if (quota) {
        const percentage = (usedBandwidth / quota * 100).toFixed(0);
        if (percentage > 75) {
          proxies.forEach(
            proxy => {
              proxy.name += ` ${percentage}%`;
              return proxy;
            }
          );
        }
      }
    }
  }

  return {
    proxies,
    hosts: content.hosts || {},
    nameservers: (
      profile.nameservers && Array.isArray(content.dns?.nameserver)
        ? content.dns?.nameserver : []
    )
  };
}

async function consolidate(template, profileRecordsPath, injectionsPath) {
  const hostsInProfiles = [];
  const nameserversInProfiles = [];

  const [profileTemplate, fetchedProxies, injections] = await Promise.all([
    fsp.readFile(template, "utf-8").then(load),
    import(profileRecordsPath).then(data => data.default)
      .then(profiles => Promise.allSettled(
        profiles.map(p => parseProfile(p).then(
          ({proxies, hosts, nameservers}) => {
            hostsInProfiles.push(hosts);
            nameserversInProfiles.push(nameservers);
            return proxies;
          }
        ))
      )),
    (async () => {
      if (injectionsPath && typeof injectionsPath === "string") {
        return load(
          await fsp.readFile(injectionsPath, "utf-8")
        );
      }
    })()
  ]);

  const proxies = fetchedProxies.filter(
    job => {
      switch (job.status) {
        case "fulfilled":
          return true;
        default: // rejected
          console.error(job.reason);
          return false;
      }
    }
  ).map(result => result.value).reduce(
    (a, e) => a.concat(e), []
  );

  const hosts = hostsInProfiles.reduce(
    (obj, h) => Object.assign(obj, h), {}
  );

  const dohs = new Set(nameserversInProfiles.reduce(
    (a, e) => a.concat(e.filter(
      ns => typeof ns === "string" && ns.startsWith("https://")
    )), []
  ));

  if (!proxies.length) {
    throw new Error("Every profile processing has failed.");
  }

  const combinedProfile = profileTemplate;

  combinedProfile.proxies = (
    Array.isArray(combinedProfile.proxies)
      ? combinedProfile.proxies.concat(proxies)
      : proxies
  );

  if (!Array.isArray(combinedProfile["proxy-groups"])) {
    console.warn(`!Array.isArray(combinedProfile["proxy-groups"])`);
    combinedProfile["proxy-groups"] = [{
      name: "Proxy",
      type: "select",
      proxies: ["DIRECT"]
    }];
  }

  if (injections) {
    let proxyPseudonym = "";
    for (const proxyGroup of combinedProfile["proxy-groups"]) {
      if (/proxy/i.test(proxyGroup.name)) {
        proxyPseudonym = proxyGroup.name;
        break;
      }
    }

    if (!proxyPseudonym) {
      proxyPseudonym = combinedProfile["proxy-groups"][0].name;
    }

    if (!Array.isArray(combinedProfile.rules)) {
      console.warn(`!Array.isArray(combinedProfile.rules)`);
      combinedProfile.rules = [];
    }

    let rules = [];
    for (const key in injections) {
      if (combinedProfile["proxy-groups"].every(
        g => g.name !== key)) {
        combinedProfile["proxy-groups"].push(
          {
            name: key,
            type: "select",
            proxies: ["DIRECT", proxyPseudonym]
          }
        );
      }

      rules = rules.concat(
        injections[key].payload
      );
    }

    combinedProfile.rules = rules.concat(
      combinedProfile.rules
    );
  }

  combinedProfile["proxy-groups"].forEach(
    group => group.proxies = (
      Array.isArray(group.proxies)
        ? group.proxies.concat(proxies.map(p => p.name))
        : proxies.map(p => p.name)
    )
  );

  const nameservers = (
    Array.isArray(combinedProfile.dns.fallback)
      ? combinedProfile.dns.fallback.concat(
        combinedProfile.dns.nameserver
      ).filter(
        ns => typeof ns === "string" && ns.startsWith("https://")
      )
      : Array.isArray(combinedProfile.dns.nameserver)
        ? combinedProfile.dns.nameserver.filter(
          ns => typeof ns === "string" && ns.startsWith("https://")
        ) : []
  );

  combinedProfile.hosts = combinedProfile.hosts || {};

  for (const doh of dohs) {
    if (!nameservers.includes(doh)) {
      try {
        const dohHostname = new URL(doh).hostname;
        if (hosts[dohHostname] && !combinedProfile.hosts[dohHostname]) {
          combinedProfile.hosts[dohHostname] = hosts[dohHostname];
        }
        nameservers.push(doh);
      } catch (err) {
        console.error(err);
      }
    }
  }

  if (Array.isArray(combinedProfile.dns.fallback)) {
    combinedProfile.dns.fallback = nameservers;
  } else {
    combinedProfile.dns.nameserver = nameservers;
  }

  combinedProfile["proxy-groups"].sort(
    (groupA, groupB) => {
      if (groupA.name.length <= groupB.name.length) {
        return -1;
      }

      return 1;
    }
  );

  return combinedProfile;
}

async function consolidateQuantumultConf(quantumultConfPath, profileRecordsPath) {
  const [conf, fetchedProxies] = await Promise.all([
    fsp.readFile(quantumultConfPath, "utf-8"),
    import(profileRecordsPath).then(data => data.default)
      .then(profiles => Promise.allSettled(
        profiles.map(
          p => parseProfile(p).then(({proxies}) => proxies)
        )
      ))
  ]);

  const errors = [];
  const proxies = fetchedProxies.filter(
    job => {
      switch (job.status) {
        case "fulfilled":
          return true;
        default: // rejected
          console.error(job.reason);
          errors.push(job.reason);
          return false;
      }
    }
  ).map(result => result.value).reduce(
    (a, e) => a.concat(e), []
  );

  if (!proxies.length) {
    throw new Error(
      errors.map(err => err?.message || "")
        .join("\r\n").concat(
          "Every profile processing has failed."
        )
    );
  }

  const servers = proxies.filter(
    p => p.type === "trojan" && !p["skip-cert-verify"]
  ).map(
    p => `trojan = ${p.server
      }:${p.port
      }, password=${p.password
      }, over-tls=true, tls13=true, fast-open=false, udp-relay=true, tag=${p.name}`
  );

  return conf.replace(/(([\r\n]|^)\[server_local\]\s*[\r\n])/, `$1${servers.join("\n")}\n`);
}

export { consolidate, consolidateQuantumultConf };