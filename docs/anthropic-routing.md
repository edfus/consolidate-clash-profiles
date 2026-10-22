# Anthropic / Claude 路由与节点限制

更新日期：2026-10-22。本次候选适用于 Mihomo / Clash Meta；已发布 Quantumult X 保持原有加拿大节点，未重新生成或发布。

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

被 Git 忽略的 `profiles.js` 从公开的 `policies/anthropic.js` 引用筛选和排序策略。
本次按用户指定替换加拿大候选池，只接受两个精确的实际节点名：

- `[Ytoo] Japan 02`：Ytoo 日本高级 02 在当前订阅中的名称，默认首选。
- `[TAG] Japan-5G网络 10x`：备用，列在第二位。

保持 `type: select`。第二项是手动备用，不表示主节点失效后自动切换。
仅一个指定节点可用时使用它；两个都缺失时生成明确报错，不回退到其他节点或 DIRECT。
精确白名单不接受相似数字、其他供应商、地区组或倍率变体。供应商更名需重新 review。

三个模板通过共享策略在生成结束时统一应用，不需要改模板文本。规则、ToDesk 优先级、
ASMR/Futu、Fake-IP、嗅探、UDP 443 拒绝及 TUN stack 保持不变。已发布 QX 不受本次修改影响；
QX 生成器会读取未来输入 meta 的实际 Anthropic 分组，未来重新发布前需单独 review。

节点标签不是实际出口位置或可用性的证明。客户端保存的手选会覆盖默认排序，
刷新后应确认 Anthropic 选中 Ytoo Japan 02。以下 2026-10-16 加拿大测试记录为历史记录。

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

`node --test tests/anthropic-routing.test.js` 验证三个模板、合并优先级、旧模板升级、IP 边界、进程规则、域名、策略组限制和无可用节点时报错。`tests/anthropic-canada.test.js`（保留原文件名）现验证两个精确节点、Ytoo 首选、单节点可用及两者均缺失时报错。若本地存在 profiles.js，还验证真实筛选函数及三个模板的记录。

Mihomo v1.19.29 的实际内核离线测试通过 8 条连接：域名、IPv4 两个边界内地址、IPv6、Datadog、以纯 IP 建连的 TLS SNI 和 HTTP Host，以及从默认加拿大 03 切换到加拿大 01 节点。`tests/mihomo-routing.py` 可复现此测试，输入为生成后的配置 JSON。测试保留生成的 Anthropic 组、规则和 sniffer，将远端节点替换为本地 SOCKS 记录器，不连接真实服务。

2026-10-16 验证使用 VPS 当前生产镜像与只读私密输入，在隔离容器中实时生成三套配置；节点数为 140 / 137 / 140。节点、DNS、规则内容与其他分组成员及默认项均保持不变。QX 候选通过实际 meta 结果重新生成，140 个节点保持不变，除 Anthropic 策略行外与当前发布配置逐字节一致。客户端刷新后需检查 Anthropic 的实际选中项为 Canada 03；订阅排序不会强制覆盖客户端保存的手选状态。

域名不可见（例如 ECH）且进程不可识别、目的 IP 又不在官方网段时，无法可靠分类。浏览器共享进程、Node/Python 包装的 CLI、自定义 OTLP trace 收集器、Bedrock/Vertex、自定义 API 网关可能需要额外明确域名。任意自定义 telemetry 地址不能从服务名称推断。

纯 IP 规则只作用于已经进入 Mihomo 的连接；系统代理不能保证所有应用流量被接管。TUN 保留原有设置：meta/tun 使用 system，mobile 不新增 TUN 配置。目标机器仍需按客户端实际情况启用 TUN 或显式代理。现有 IPv6 开关保持不变；IPv6 目的匹配已经验证，但不意味着已启用系统 IPv6。

## 应用

Review 通过后，备份本次涉及的远端文件并保存旧镜像，通过明确文件清单 rsync 更新公开代码，构建并验证包含 index.js/templates 的新镜像，仅重建 clash-profiles。私密配置留在挂载和 Git ignore 中。本次不改依赖。客户端随后刷新订阅、重新加载，使用 Rule 模式，并检查 Anthropic 实际选中 Ytoo Japan 02。不要继续使用旧 output 中未重新生成的配置。

## Claude 传输优化（2026-10-16）

meta/mobile/tun 保留 `dns.enhanced-mode: fake-ip`，将 `+.claude.ai`、`+.claude.com`、`+.anthropic.com` 加入 `sniffer.force-domain`，不加入 `fake-ip-filter`。后者在当前 blacklist 模式下会返回真实 IP，与本次选择相反。保留原有 DNS 上游与防回环设置。

全局 `AND,((NETWORK,UDP),(DST-PORT,443)),REJECT` 放在第一条，包括 profiles/injections、ToDesk、Anthropic、Futu 和国内路由之前。因此 ToDesk 的 UDP 443 也会被拒绝；其他 ToDesk 连接继续优先 DIRECT。删除 mobile/tun 中原有的境外 UDP 443 可选路由，保留其分组以兼容客户端手选。QUIC 8443 不受这条规则影响。

根据 review 决定，本次不切换 gvisor：meta/tun 保留 `tun.stack: system` 和所有原有 TUN 开关，mobile 不新增 TUN 配置。UDP 拒绝不会转换成 TCP；支持回退的应用会重试 TCP，仅支持 QUIC 的应用可能无法连接。ECH 或缺失域名仍可能使嗅探失效。此变更不修改 Quantumult X。

官方语义：[DNS Fake-IP filter](https://wiki.metacubex.one/config/dns/#fake-ip-filter)、[force-domain](https://wiki.metacubex.one/config/sniff/#force-domain)、[TUN stack](https://wiki.metacubex.one/config/inbound/tun/)、[首条命中及逻辑规则](https://wiki.metacubex.one/config/rules/)。

候选验证：三套真实生成订阅通过 Mihomo v1.19.29 的完整配置解析。`tests/mihomo-claude-transport.py` 对每套结果验证六个主域/子域仍返回 Fake-IP、九类 UDP 443 请求命中 REJECT，以及 UDP 9000 的前后正向对照；出站只进入本机 SOCKS 记录器，不访问真实目标。`tests/mihomo-routing.py` 保留全局 UDP 拒绝规则后，每套八个 TCP 路由探针仍通过，加拿大 03 默认及手选 01 均有效。尚未在实际客户端启用操作系统 TUN，也未验证真实服务连接和应用 TCP 回退；上线后需刷新并重新加载客户端实测。

2026-10-22：用户已 review 并授权部署当前日本双节点方案。三套最终生成结果和内核路由验证见私密 review 报告；不将离线本地 SOCKS 验证视为实际节点连通性测试。

2026-10-22 本地验证：30 项 Node 回归通过；基于当天经严格 HTTPS 验证下载的实时
meta/mobile/tun 节点快照，在回环 HTTP 源上重放真实合并器，核验新筛选和顺序。
完整 review 候选只替换实时配置的 Anthropic 分组；节点数为 140 / 137 / 140，
其他分组、规则、DNS、嗅探和 TUN 与实时快照一致。三套完整候选通过 Mihomo
配置加载及每套 8 个本地路由探针，覆盖默认 Ytoo Japan 02 和手动切换 TAG 日本 5G。
尚未从 VPS 私密原始来源重新生成：SSH 已知主机记录缺失，未绕过主机校验。
部署前需先核验主机指纹，再以生产依赖和只读私密来源完成新一轮实时生成验证。
未测试实际节点连通性或出口；本次未提交、推送、部署或修改已发布 QX。
