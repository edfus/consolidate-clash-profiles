# Anthropic / Claude 路由与节点限制

更新日期：2026-10-16。此更新适用于 Mihomo / Clash Meta；Quantumult X 同步使用加拿大节点及 03 首选。

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

被 Git 忽略的 `profiles.js` 从公开的 `policies/anthropic.js` 引用 `proxyGroupFilters` 和 `proxyGroupPriorities`。筛选只接受名称带独立 Canada 单词、加拿大或 🇨🇦 标识的实际代理节点；不接受 Proxy、DIRECT、地区组、provider 或含义不明确的 CA 简称。

加拿大区域标识后的第一个数字字段为 03/3 时，节点排在首位；其余加拿大节点保留原有顺序。不将 13/30/003、倍率 3x、到期天数或重复后缀当作节点 03。偏好排序在区域筛选后应用，不能放入非加拿大节点。

当前三套实时订阅均有三个加拿大候选。目标顺序：

- `[TAG] Canada- Residential 03 1x`（默认首选）
- `[TAG] Canada- Residential 01 2x`
- `[TAG] Canada- Residential 02 2x`

如果没有 03，保持其他加拿大节点的顺序；如果没有任何加拿大节点，沿用既有限制组的明确报错行为，不回退到其他地区。

此前的洛杉矶 02/06 白名单由本次候选替换。规则目标、ToDesk 优先级、ASMR/Futu、DNS 与节点内容不变。Quantumult X 通过实际生成的 meta 配置同步 Anthropic 候选及顺序，保留现有节点、其他策略与规则；其 static 分组同样以 03 开始。meta/mobile/tun 的模板无需修改：同一私密来源策略在三套配置生成结束时统一应用。

节点标签不等于实际出口位置证明；供应商改变实际出口时需要重新核验。select 的第一项是新加载配置的默认值，客户端保留的历史手选可能需要切换到 03。

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

`node --test tests/anthropic-routing.test.js` 验证三个模板、合并优先级、旧模板升级、IP 边界、进程规则、域名、策略组限制和无可用节点时报错。`tests/anthropic-canada.test.js` 另验证 Canada 标签边界、03 首选、无 03 回退及无加拿大节点时报错。若本地存在 profiles.js，还验证真实筛选函数及三个模板的记录。

Mihomo v1.19.29 的实际内核离线测试通过 8 条连接：域名、IPv4 两个边界内地址、IPv6、Datadog、以纯 IP 建连的 TLS SNI 和 HTTP Host，以及从默认加拿大 03 切换到加拿大 01 节点。`tests/mihomo-routing.py` 可复现此测试，输入为生成后的配置 JSON。测试保留生成的 Anthropic 组、规则和 sniffer，将远端节点替换为本地 SOCKS 记录器，不连接真实服务。

2026-10-16 验证使用 VPS 当前生产镜像与只读私密输入，在隔离容器中实时生成三套配置；节点数为 140 / 137 / 140。节点、DNS、规则内容与其他分组成员及默认项均保持不变。QX 候选通过实际 meta 结果重新生成，140 个节点保持不变，除 Anthropic 策略行外与当前发布配置逐字节一致。客户端刷新后需检查 Anthropic 的实际选中项为 Canada 03；订阅排序不会强制覆盖客户端保存的手选状态。

域名不可见（例如 ECH）且进程不可识别、目的 IP 又不在官方网段时，无法可靠分类。浏览器共享进程、Node/Python 包装的 CLI、自定义 OTLP trace 收集器、Bedrock/Vertex、自定义 API 网关可能需要额外明确域名。任意自定义 telemetry 地址不能从服务名称推断。

纯 IP 规则只作用于已经进入 Mihomo 的连接；系统代理不能保证所有应用流量被接管。模板原有 TUN 设置保持不变，目标机器需按客户端实际情况启用 TUN 或显式代理。现有 IPv6 开关保持不变；IPv6 目的匹配已经验证，但不意味着已启用系统 IPv6。

## 应用

备份目标项目，将更新包 files/ 下文件覆盖到项目根目录（含 profiles.js），按需 `npm install` 修复依赖；重启生成服务并刷新客户端订阅。使用 Rule 模式，在 Anthropic 组选择 02 或 06。不要继续使用旧 output 中未重新生成的配置。
