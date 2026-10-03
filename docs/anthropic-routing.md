# Anthropic / Claude 路由与节点限制

核对日期：2026-10-03。此更新适用于 Mihomo / Clash Meta。

## 路由覆盖

`rules/Anthropic.yml` 是生成器使用的规则来源。三个模板同步内嵌规则；生成器将其放在 profiles 和 injections 规则前，且正确将 `no-resolve` 放在策略组之后。新配置无需等待远端规则文件发布。

- 主站、API、OAuth、下载、MCP、Artifacts、短链接：Anthropic / Claude 系列域名，另补充 `clau.de`、`claude.dev`、`claudemcpcontent.com` 及品牌 CDN / Auth0 主机。
- 遥测和 trace：Anthropic 自有子域名（包括 statsig、sentry、trace 等），Sentry、Statsig、GrowthBook、Fathom、Datadog 已知日志/浏览器采集端点。
- 支持、验证和下载：Intercom、Cloudflare challenge、Google Storage。
- 纯 IP：官方入站 IPv4 `160.79.104.0/23`、IPv6 `2607:6bc0::/48`，均使用 `no-resolve`。
- IP 建连但带有域名：启用 HTTP/TLS/QUIC 嗅探，`parse-pure-ip: true`，不改写原始连接目标。
- 原生客户端：Claude/claude 和 Windows 对应进程名，以及列出的 macOS Helper 进程，作为其他目标的兜底。进程规则会涵盖这些进程自身发起的其他请求。

Sentry、Statsig、Intercom、Google Storage 和部分精确 CDN/日志主机是共享服务；其他应用访问这些已列出的域名也会走 Anthropic 组。没有加入全局 `trace`、`sentry`、`datadog` 关键词规则，也没有把整个 Cloudflare/Google/AWS 网段转入此组。

官方的 `160.79.104.0/21` 是服务器主动请求外部资源时的出站源地址范围，不作为客户端目的网段加入。官方已退役的五个 `34.162.*` 地址也未加入。

## profiles.js 的节点限制

被 Git 忽略的 `profiles.js` 新增命名导出 `proxyGroupFilters.Anthropic`。生成器在组装结束时应用筛选，候选只来自实际代理节点，不接受 Proxy、DIRECT、地区组或 provider 作为间接入口。

只接受洛杉矶名称（`洛杉矶`、`Los Angeles`、`L.A.`、`LAX`、`LA`）后紧跟编号 2/6，包括 02/06。12、16、26、倍率 2x、到期天数、重复节点后缀均不算。若没有符合节点则明确报错，避免静默回退到其他地区。

本地 TAG 订阅快照经实际 profiles.js 映射、injections 和三种模板合并后，该组均为：

- `[TAG] L.A. 02 1x`
- `[TAG] L.A. 06 1x`

按节点名称筛选不等于测定出口 IP 地理位置；供应商改变实际出口时需要重新核验。另外修复了 metaProfiles 原地改写 tunProfiles 的问题，使 tun.yml 仍有自己的有效输入记录。

## 来源及采用范围

- [MetaCubeX Anthropic rules](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/classical/anthropic.yaml)：品牌域名、MCP 内容域名和 CDN。
- [v2fly domain-list-community](https://github.com/v2fly/domain-list-community/blob/master/data/anthropic)：交叉核对核心域名。
- [blackmatrix7 Claude rules](https://github.com/blackmatrix7/ios_rule_script/blob/master/rule/Clash/Claude/Claude.yaml)：Fathom 域名。
- [Anthropic 官方开发容器防火墙](https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh)：Sentry、Statsig 依赖。
- [Anthropic 官方 IP 文档](https://platform.claude.com/docs/en/api/ip-addresses)：入站 IPv4/IPv6；区分出站地址与退役地址。
- [erwanjun Claude 完整规则](https://github.com/erwanjun/surge-claude-rules/blob/main/Surge/Claude.list)：核对第三方遥测端点；未照搬宽泛关键词或 ASN。
- [GrowthBook 故障报告](https://github.com/anthropics/claude-code/issues/64151)：cdn.growthbook.io 的客户端依赖证据。
- [Datadog 客户端错误报告](https://github.com/anthropics/claude-code/issues/13112)：旧日志采集主机的证据。
- [Mihomo 嗅探文档](https://wiki.metacubex.one/config/sniff/)及[规则语法](https://wiki.metacubex.one/config/rules/)：纯 IP 嗅探、规则顺序和 no-resolve。

## 验证及范围

`node --test tests/anthropic-routing.test.js` 验证三个模板、合并优先级、旧模板升级、IP 边界、进程规则、域名、策略组限制和无可用节点时报错。若本地存在 profiles.js，还验证真实筛选函数及三个模板的记录。

Mihomo v1.19.29 的实际内核离线测试通过 8 条连接：域名、IPv4 两个边界内地址、IPv6、Datadog、以纯 IP 建连的 TLS SNI 和 HTTP Host，以及切换到 06 节点。`tests/mihomo-routing.py` 可复现此测试，输入为生成后的配置 JSON。测试保留生成的 Anthropic 组、规则和 sniffer，将远端节点替换为本地 SOCKS 记录器，不连接真实服务。

本地订阅快照验证使用 TAG/Ytoo；没有快照的来源使用显式测试节点以检查完整配置结构，不将缓存或测试节点冒充实时订阅。三个完整生成配置均通过 Mihomo `-t`。tun/mobile 的旧 SCRIPT 语法已换成原生 AND/NETWORK/DST-PORT/GEOIP 组合规则，以匹配 UDP 443 非中国目标、星铁 UDP 23301 及原 tun 的 TCP 441 规则。本次没有修改正在运行的 Clash Verge、发布配置或验证远端节点连通性。

域名不可见（例如 ECH）且进程不可识别、目的 IP 又不在官方网段时，无法可靠分类。浏览器共享进程、Node/Python 包装的 CLI、自定义 OTLP trace 收集器、Bedrock/Vertex、自定义 API 网关可能需要额外明确域名。任意自定义 telemetry 地址不能从服务名称推断。

纯 IP 规则只作用于已经进入 Mihomo 的连接；系统代理不能保证所有应用流量被接管。模板原有 TUN 设置保持不变，目标机器需按客户端实际情况启用 TUN 或显式代理。现有 IPv6 开关保持不变；IPv6 目的匹配已经验证，但不意味着已启用系统 IPv6。

## 应用

备份目标项目，将更新包 files/ 下文件覆盖到项目根目录（含 profiles.js），按需 `npm install` 修复依赖；重启生成服务并刷新客户端订阅。使用 Rule 模式，在 Anthropic 组选择 02 或 06。不要继续使用旧 output 中未重新生成的配置。
