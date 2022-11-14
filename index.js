import { load } from 'js-yaml';
import { promises as fsp } from 'fs';
import { basename } from "path";
import { fetchProfile } from "./fetch.js";
import logger from './logger.js';

const noModification = p => p.proxies || [];
async function parseProfile(profile, specifiedTemplate, specifiedUser = "default", specifiedProfile = "default") {
  profile = typeof profile === "object" ? profile : {
    url: profile
  };

  profile = Object.assign({
    map: noModification,
    nameservers: true,
    hosts: true,
    profiles: ["default"],
    users: ["default"],
    rules: {
      prepended: [],
      appended: []
    },
  }, profile);

  if ("templates" in profile) {
    if (!Array.isArray(profile.templates)) {
      logger.debug(`${profile.url}: profile.templates: !isArray, = [ ${profile.templates} ];`);
      profile.templates = [profile.templates];
    }
    if(!profile.templates.includes(specifiedTemplate)){
      logger.debug(`${profile.url}: profile.templates: !${profile.templates}.includes(${specifiedTemplate})`);
      return null;
    }
  }

  if (typeof profile.users === "string") {
    logger.debug(`${profile.url}: profile.users: string, = [ ${profile.users} ];`);
    profile.users = [ profile.users ];
  }
  
  if (!Array.isArray(profile.users)) {
    logger.debug(`${profile.url}: profile.users: !Array.isArray(${profile.users})`);
  } else {
    if (!profile.users.includes(specifiedUser)) {
      logger.debug(`${profile.url}: profile.users: !${profile.users}.includes(${specifiedUser})`);
      return null;
    }
  }

  if (typeof profile.profiles === "string") {
    logger.debug(`${profile.url}: profile.profiles: string, = [ ${profile.profiles} ];`);
    profile.profiles = [ profile.profiles ];
  }
  
  if (!Array.isArray(profile.profiles)) {
    logger.debug(`${profile.url}: profile.profiles: !Array.isArray(${profile.profiles})`);
  } else {
    if (!profile.profiles.includes(specifiedProfile)) {
      logger.debug(`${profile.url}: profile.profiles: !${profile.profiles}.includes(${specifiedProfile})`);
      return null;
    }
  }

  const response = await fetchProfile(profile.url);
  const userInfo = response.headers["subscription-userinfo"];
  const content = load(response.payload);

  const proxies = profile.map(content);
  if (!Array.isArray(proxies)) {
    throw new TypeError(
      `${response.url}: map: malformed function: expected returned value to be of type Array`
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

  if (!profile.rules || typeof profile.rules !== "object") {
    logger.debug(`${profile.url}: profile.rules: discarded`);
    profile.rules = {};
  }

  if (Array.isArray(profile.rules)) {
    logger.debug(`${profile.url}: profile.rules: Array.isArray(${profile.rules}): will prepend`);
    profile.rules = {
      prepended: profile.rules,
      appended: []
    }
  }

  if(!profile.rules?.prepended || !Array.isArray(profile.rules.prepended)) {
    profile.rules.prepended = [];
  }

  if(!profile.rules?.appended || !Array.isArray(profile.rules.appended)) {
    profile.rules.appended = [];
  }

  if("proxyServersConnectMethod" in profile) {
    const connectMethod = profile.proxyServersConnectMethod;
    if(!["DIRECT", "Proxy"].includes(connectMethod)) {
      logger.warn(`Uncommon connectMethod ${profile.proxyServersConnectMethod} in profile ${JSON.stringify(profile)}`);
    }
    const servers = proxies.map(
      proxy => typeof proxy?.server === "string" && proxy.server
    ).filter(Boolean);

    const uniqueServers = [...new Set(servers)];
    const directConnectionRules = uniqueServers.map(
      serverAddress => {
        if(/[a-z]/i.test(serverAddress)) {
          return `DOMAIN,${serverAddress},DIRECT`;
        }
        if(serverAddress.includes(":")) {
          return `IP-CIDR6,${serverAddress}/128,DIRECT,no-resolve`;
        }
        return `IP-CIDR,${serverAddress}/32,DIRECT,no-resolve`;
      }
    );
    profile.rules.prepended = profile.rules.prepended.concat(
      directConnectionRules
    );
  }

  return {
    proxies,
    hosts: profile.hosts && content.hosts || {},
    nameservers: (
      profile.nameservers && Array.isArray(content.dns?.nameserver)
        ? content.dns?.nameserver : []
    ),
    rules: profile.rules
  };
}

async function consolidate(template, profileRecordsPath, injectionsPath, specifiedUser, specifiedProfile) {
  const hostsInProfiles = [];
  const nameserversInProfiles = [];
  const rulesInProfiles = {
    prepended: [],
    appended: []
  };
  const specifiedTemplate = basename(template);

  const [profileTemplate, fetchedProxies, injections] = await Promise.all([
    fsp.readFile(template, "utf-8").then(load),
    import(profileRecordsPath).then(data => data.default)
      .then(profiles => Promise.allSettled(
        profiles.map(p => parseProfile(
          p, specifiedTemplate, specifiedUser, specifiedProfile).then(
          profile => {
            if(!profile) return null;
            hostsInProfiles.push(profile.hosts);
            nameserversInProfiles.push(profile.nameservers);
            rulesInProfiles.prepended = rulesInProfiles.prepended.concat(
              profile.rules.prepended
            );
            rulesInProfiles.appended = rulesInProfiles.appended.concat(
              profile.rules.appended
            );
            return profile.proxies;
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

  const proxiesWithPossibleDuplicates = fetchedProxies.filter(
    job => {
      switch (job.status) {
        case "fulfilled":
          return true;
        default: // rejected
          logger.error(job.reason);
          return false;
      }
    }
  ).map(result => result.value).reduce(
    (a, e) => Array.isArray(e) ? a.concat(e) : a, []
  );

  const hosts = hostsInProfiles.reduce(
    (obj, h) => Object.assign(obj, h), {}
  );

  const dohs = new Set(nameserversInProfiles.reduce(
    (a, e) => a.concat(e.filter(
      ns => typeof ns === "string" && ns.startsWith("https://")
    )), []
  ));

  const proxyTable = new Map();
  
  for (const proxy of proxiesWithPossibleDuplicates) {
    for (let proxyName = proxy.name, i = 0; ; proxyName = `${proxyName} (${++i})`) {
      if(!proxyTable.has(proxyName)) {
        const newProxy = Object.assign({}, proxy);
        newProxy.name = proxyName;
        proxyTable.set(proxyName, newProxy);
        break;
      }

      // proxies[proxyName] exists
      if (JSON.stringify(proxyTable.get(proxyName)) === JSON.stringify(proxy)) {
        break;
      }
    }
  }

  const proxies = Array.from(proxyTable.values());

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
    logger.warn(`!Array.isArray(combinedProfile["proxy-groups"])`);
    combinedProfile["proxy-groups"] = [{
      name: "Proxy",
      type: "select",
      proxies: ["DIRECT"]
    }];
  }

  let customRules = rulesInProfiles.prepended;
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

      customRules = customRules.concat(
        injections[key].payload
      );
    }
  }

  if (!Array.isArray(combinedProfile.rules)) {
    logger.warn(`!Array.isArray(combinedProfile.rules)`);
    combinedProfile.rules = [];
  }
  
  combinedProfile.rules = customRules.concat(
    combinedProfile.rules
  ).concat(rulesInProfiles.appended);

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

  combinedProfile.hosts = Object.assign(combinedProfile.hosts || {}, hosts);

  for (const doh of dohs) {
    if (!nameservers.includes(doh)) {
      try {
        const dohHostname = new URL(doh).hostname;
        // if (hosts[dohHostname] && !combinedProfile.hosts[dohHostname]) {
        //   combinedProfile.hosts[dohHostname] = hosts[dohHostname];
        // }
        nameservers.push(doh);
      } catch (err) {
        logger.error(err);
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
          logger.error(job.reason);
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