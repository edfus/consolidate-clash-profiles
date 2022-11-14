1. http2 supported
2. robust in-memory and filesytem caching for requests and responses
3. configurations are constantly monitored and always hot reloaded
4. automated rulesets upload to cloudflare with version control
5. debug logging with process.env.LOG_LEVEL

injections.yml
1. add new proxy rules with injections.yml or property `rules` in profiles!

profiles.js
1. filter profiles with username, template name, usage and etc..
2. supports custom javascript mapping functions
3. add new proxy rules with property `rules` in each profile
4. add new proxy groups with property `proxyGroups` in each profile plus several other options to make it the way exactly you want



