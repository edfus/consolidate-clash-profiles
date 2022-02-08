import { load } from 'js-yaml';
import { promises as fsp } from 'fs';
import { fetchProfile } from "./fetch.js";

async function consolidate (template, profileRecordsPath) {
  const hostsInProfiles = [];
  const nameserversInProfiles = [];
  const profiles = (await import(profileRecordsPath)).default; 

  const [profileTemplate, fetchedProxies] = await Promise.all([
    fsp.readFile(template, "utf-8"),
    Promise.allSettled(
      profiles.map(
        async profile => {
          profile = typeof profile === "object" ? profile : {
            url: profile,
            map: p => p.proxies || []
          };
          const response = await fetchProfile(profile.url);
          const userInfo = response.headers["subscription-userinfo"];
          const content = load(response.payload);

          hostsInProfiles.push(content.hosts || {});
          nameserversInProfiles.push(
            Array.isArray(content.dns?.nameserver)
            ? content.dns?.nameserver : []
          );

          const proxies = profile.map(content);
          if (!Array.isArray(proxies)) {
            throw new TypeError(
              `${response.url}: malformed map function: expected returned value to be of type Array`
              );
          }

          if(userInfo) {
            const userInfoObj = userInfo.split(/;\s*/).reduce(
              (acc, str) => {
                const [key, value] = str.split("=");
                acc[key.trim()] = value;
                return acc;
              }, {}
            );

            if(userInfoObj["expire"]) {
              const remainDays = (
                parseInt(userInfoObj["expire"]) - Date.now() / 1000
              ) / (60 * 60 * 24);

              if (remainDays < 16) {
                proxies.forEach(
                  proxy => {
                    proxy.name += ` [Expire in ${remainDays.toFixed(0)} days]`;
                    return proxy;
                  }
                )
              }
            }

            const usedBandwidth = (
              (parseInt(userInfoObj["upload"]) || 0)
              + parseInt(userInfoObj["download"])
            );

            if(usedBandwidth && userInfoObj["total"]) {
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

            return proxies;
          }
        }
      )
    )
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

  const combinedProfile = load(profileTemplate);

  combinedProfile.proxies = (
    Array.isArray(combinedProfile.proxies)
      ? combinedProfile.proxies.concat(proxies)
      : proxies
  );

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
    if(!nameservers.includes(doh)) {
      try {
        const dohHostname = new URL(doh).hostname;
        if(hosts[dohHostname] && !combinedProfile.hosts[dohHostname]) {
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

  return combinedProfile;
}

export { consolidate };