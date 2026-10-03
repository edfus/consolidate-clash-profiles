1. http2 supported
2. robust in-memory and filesytem caching for requests and responses
3. configurations are constantly monitored and always hot reloaded
4. automated rulesets upload to cloudflare with version control
5. debug logging with process.env.LOG_LEVEL
6. send SIGHUP signal to the process to reload logger.conf.js.

injections.yml
1. add new proxy rules with injections.yml or property `rules` in profiles!

profiles.js
1. filter profiles with username, template name, usage and etc..
2. supports custom javascript mapping functions
3. add new proxy rules with property `rules` in each profile
4. add new proxy groups with property `proxyGroups` in each profile plus several other options to make it the way exactly you want




## Anthropic / Claude routing

All three Mihomo templates and `consolidate()` prioritize explicit ToDesk DIRECT
rules, followed by Anthropic rules before general routing.
Coverage includes service domains, telemetry dependencies, official IPv4/IPv6
inbound ranges, HTTP/TLS/QUIC sniffing and native Claude process fallbacks.

Private `profiles.js` exports `proxyGroupFilters.Anthropic` to restrict the final
selector to Los Angeles node IDs 02/06. No matching node is an error; generic
Proxy groups cannot bypass the restriction. Other profile modules can export
`proxyGroupFilters` as a map of group names to node predicate functions.

See [routing details, sources, scope and migration](docs/anthropic-routing.md).
Run `node --test tests/anthropic-routing.test.js` with installed dependencies.

## ToDesk direct routing

ToDesk domains and native processes use `DIRECT` before general and AI rules in
all three templates and generated subscriptions. See [sources and process-matching scope](docs/todesk-direct.txt).
