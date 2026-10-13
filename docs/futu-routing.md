# Futu / ASMR routing review

Prepared on 2026-10-13. User review approved on 2026-10-13.
Approved decisions: manual HK-first ASMR selection, REJECT when HK/JP is absent,
and scoped Futu domain/process matching without shared-cloud CIDRs.
Deployment results will be recorded separately after production acceptance.

## Follow-up awaiting review

The current local follow-up adds an independent `Futu` selector to both Clash
and Quantumult X, defaulting to Proxy/proxy. Quantumult X also receives ASMR.
This follow-up is not committed or deployed. See
[the follow-up review](quantumultx-asmr-futu-review.txt) for changes and validation.
The previous deployment behavior and its research record are retained below.

## Proposed behavior

- `asmr.one` and subdomains use an independent `ASMR` select group. Only actual
  nodes whose names identify HK/JP are offered; HK nodes precede JP nodes. The first HK node is the
  initial selection. This is a manual selector, not a latency test or automatic
  failover group. Previously saved client selections may override the initial
  selection. If neither region exists, only REJECT is offered.
- Futu / Moomoo use the existing main Proxy group, without a separate brokerage
  selector. There are 46 explicit domain suffixes, one exact host and four
  process names. This includes account, quote, trade, OpenAPI, static resources,
  regional services, ESOP and trustee services. Redundant subdomain rules were
  removed where an included parent suffix already covers them.
- Process names: FTNN, FTNN.exe, FutuOpenD, FutuOpenD.exe. FTNN is evidenced by
  the macOS audit below; Windows process variants need real Windows runtime
  confirmation. Process matching depends on client platform and permissions.
- Raw IP traffic from a recognized desktop process uses Proxy. Existing sniffer
  settings recover HTTP/TLS/QUIC domain names where possible. Unattributed,
  non-sniffable IP connections retain existing routing; mobile process matching
  may be unavailable. This proposal does not claim universal coverage of raw
  Futu quote/trade protocols on mobile.
- Priority: ToDesk DIRECT, existing Anthropic block, ASMR, Futu, private source
  and injection rules, existing generic rules. Existing Anthropic node filters
  and all DNS settings remain unchanged.

## GitHub research and source snapshots

| Source | What it establishes | Revision |
| --- | --- | --- |
| [v2fly Futu](https://github.com/v2fly/domain-list-community/blob/c6adacf29cc4fb05e04651fcf03e00989ef9f797/data/futu) | First-party Futu/Moomoo domain baseline | c6adacf29cc4fb05e04651fcf03e00989ef9f797 |
| [proxyBug Moomoo](https://github.com/proxyBug/tigertrade-moomoo-rules/blob/d0538b3f6825e13b7f4c328a1e4f3e616efd5d5f/Moomoo.list) | Canada, Moomoo Bull and trustee additions; explicit suffixes | d0538b3f6825e13b7f4c328a1e4f3e616efd5d5f |
| [forecho Futu](https://github.com/forecho/broker-rules/blob/88f05d3e0141fbadc47663ccdd7a1efe67c0d83a/Source/broker/futu.conf) | Backup/numbered domains and further regional/business coverage | 88f05d3e0141fbadc47663ccdd7a1efe67c0d83a |
| [forecho macOS audit](https://github.com/forecho/broker-rules/blob/88f05d3e0141fbadc47663ccdd7a1efe67c0d83a/Source/broker/futu-notes.md) | Reports FTNN traffic and client binary evidence for HK, ESOP and Moomoo endpoints, audited 2026-09-22 | Same revision |
| [Arthur-vx broker rules](https://github.com/Arthur-vx/broker-rules) | Mixed-broker source: requires separating Futu from Tiger, Longbridge and Schwab | Reviewed 2026-10-13 |
| [blackmatrix7 issue 1687](https://github.com/blackmatrix7/ios_rule_script/issues/1687) | Community proposal with Futu domains and many raw-IP ranges | Open proposal, not a merged dedicated Futu rule set |
| [masnmarc PR 1](https://github.com/masnmarc/broker-rules/pull/1) | Reports rotating Tencent Cloud access points and additional ranges | Community traffic audit, 2026-06-12 |
| [Futu Python SDK](https://github.com/FutunnOpen/py-futu-api) | Official OpenD / OpenAPI project | Process gateway reference |

The implemented domain data is the deduplicated union of the three pinned
Futu-only sources above. Their published lists are evidence for inclusion,
not proof that every legacy domain currently receives app traffic. No upstream
application code or generated brokerage implementation is copied.

Excluded from this proposal:

- Tiger, Longbridge and Schwab rules from mixed brokerage lists.
- Generic IM hosts such as shortconn.im.qcloud.com and loginv6.im.qcloud.com,
  universal AppsFlyer endpoints and broad `futu` / `moomoo` keywords. These can
  match unrelated applications. Futu desktop process matching covers their use
  by the recognized client without globally changing those destinations.
- Shared Tencent Cloud / CDN IP ranges. The June issue has dozens of /23 and
  /24 ranges, and the PR widens some ranges. These are rotating, multi-tenant
  destinations; adopting the entire pool would redirect unrelated traffic.
- Lookalike or parked domains such as moomoo.jp, moomoo.com.au and futu88.com,
  which the audited sources exclude.

## Approved decisions

1. Keep ASMR as a manual HK-first selector.
2. Offer only REJECT when neither HK nor JP nodes exist.
3. Use scoped Futu domains/processes; omit shared-cloud CIDRs. Add specific
   endpoints only after device-level traffic evidence.

## Verification before review

- `node --check index.js` and `node --check profiles.js` passed.
- `node --test tests/dns-routing.test.js tests/anthropic-routing.test.js
  tests/futu-asmr-routing.test.js`: four tests passed.
- YAML parsing passed for all modified templates and rule files; tests cover
  conflicting source/injection rules, ToDesk precedence, Anthropic precedence,
  group references, HK/JP ordering, no-region behavior and lookalike exclusions.
- Local private inputs were byte-compared to production without displaying
  their contents. Candidate configurations were generated from those real
  inputs and compared to authenticated production subscriptions.

| Template | Production nodes | Candidate nodes | ASMR HK | ASMR JP |
| --- | ---: | ---: | ---: | ---: |
| meta | 140 | 140 | 20 | 30 |
| mobile | 137 | 137 | 20 | 30 |
| tun | 140 | 140 | 20 | 30 |

Node payloads, DNS and Anthropic groups are identical to the fetched production
configuration for each template. All final group and rule references are valid.
All three exact candidate YAML files passed Mihomo v1.19.29 configuration
validation (`-t`). The offline core test passed 13 probes per template (39 total): Futu quote,
API, CDN, Moomoo, ASMR root/subdomain, Anthropic regression, raw-IP TLS SNI,
raw-IP HTTP Host and negative matches. Nodes are replaced by localhost SOCKS
recorders for the route test. Process rules are checked in JavaScript tests;
this does not verify OS process attribution, remote nodes, Futu login or trading.

External production HTTPS requests passed certificate validation without a
TLS bypass: anonymous 401, authenticated 200 with parseable YAML for all three
codes. These checks describe the existing service, not deployment acceptance.

A validation incident exposed a source's embedded Basic credential in tool
output when the existing logger asynchronously restored its INFO level. Further
validation explicitly disabled log methods and logger-level reloads before any
source fetch, and did not repeat the credential. Rotation of the exposed source
credential is recommended. No credential is included in public changed files.

Candidate subscription bodies are kept only in a restricted temporary directory
and are excluded from the public change set. They are not attached to this review.

## Change and deployment boundaries

Public files: index.js; templates/meta.yml, mobile.yml, tun.yml;
rules/ASMR.yml, Futu.yml; tests/futu-asmr-routing.test.js,
mihomo-futu-asmr.py; this document.

Private files, server.js, dependencies, mappings, Caddy, Trojan, certificates and
secure tunnels are unchanged. Existing untracked Quantumult X files are outside
this change. There is an existing missing .gitmodules mapping for the tracked
Compose-Trojan-Caddy gitlink; this review does not repair it.

The live image is sha256:9adbe4af994b68a76391b2403586e0256966b40a227384da5d12a862093bf689.
Host and running-container copies of index.js, all three templates, Anthropic,
ToDesk and server.js matched the original local files before this edit. Other
remote modifications are not part of the planned rsync file list.

After review approval: create a restricted timestamped backup, record and tag
this image for rollback, rsync only the explicit public file list, build a
candidate layer over the current image, validate before selecting it in Compose,
then recreate only clash-profiles using the current required environment.
Repeat external acceptance and confirm the other entrypoints are unaffected.
No broad deployment/restart script is used. Clients must refresh subscriptions
and reload configurations after deployment. Rollback restores the backed-up
public files and old image, recreates only clash-profiles and repeats acceptance.
