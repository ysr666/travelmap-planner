# 旅图 TripMap

旅图 TripMap 是面向复杂出境自由行组织者的 **智能旅行管家**。它把散落的订单、票据、地点和同行信息整理成一趟随时可执行、发生变化也能迅速调整的旅行：下一步去哪、何时出发、需要出示什么，一眼就知道。

实时在线和 AI 优先是实现这项承诺的技术战略，不是要求用户理解的产品类别。当前代码已经具备完整旅行主路径、账号对象同步、Provider Proxy 和 AI Action Gateway，是向目标架构迁移的稳定基线。目标状态以云端账号数据为事实源，以 Realtime 推送跨设备变化；IndexedDB 保留为启动缓存、弱网 outbox 和应急查看能力。

UI V3 已作为当前生产界面发布：`今日 | 行程 | 资料 | 我的`、Toolbar AI、按需 Action Sheet、阶段化首页、资料编辑式列表和自适应壳层均已进入真实代码与可执行 Golden 验收。PR #33 合并提交 `9317a9a` 的 GitHub required checks、Cloudflare Pages Production、无 Provider 生产冒烟以及项目所有者批准的 iOS/Android 模拟器发布资格均已通过。完整合同见 [产品定位与核心体验](docs/PRODUCT_POSITIONING.md)、[UI V3 重构规范](docs/UI_REFACTOR_V3.md)、[Selected Design](docs/DESIGN.md)、[实施计划](docs/UI_V3_IMPLEMENTATION_PLAN.md)、[M6 完成度审计](docs/UI_V3_M6_COMPLETION_AUDIT.md) 和 [Design QA](design-qa.md)。

## 项目定位

旅图不是攻略社区、订票平台、通用地图、聊天机器人或专业财务软件。它的核心价值是把用户已经决定或购买的复杂旅行变成可靠的执行流程：先收齐资料、确认准备情况，旅行中直接执行下一步，变化时由 AI 准备可执行调整。

适合用来：

- 汇总邮件、PDF、网页、表格、图片和手工记录中的旅行资料
- 出发前识别真正缺失、冲突或过期的内容，并一次修复可自动处理的问题
- 旅行中快速查看下一站、出发时间、导航和需要出示的票据
- 用 AI 查询、规划和执行已登记的旅行任务
- 在变化发生时查看影响并确认可逆调整
- 跨设备查看账号旅行和同行变化
- 按天管理日程，并在需要空间判断时查看地图与路线
- 手动记录从上一站到当前站的交通方式和预计耗时
- 保存或记录车票、门票、酒店订单、PDF、二维码截图
- 导出 / 导入完整 zip 归档
- 登录后通过 Supabase 自动同步账号数据
- 在弱网或离线时查看最近缓存，并在恢复连接后自动续传
- 添加到 iPhone 主屏幕，作为 PWA 使用

## ✨ 核心功能

- AI Action Gateway：自然语言规划、注册动作校验、实时预览、一次确认、依赖执行和失败步骤重试
- Realtime Cloud（目标架构）：账号旅行、协作状态和 AI job 通过云端事件实时收敛
- Unified Trip Intelligence：Trip Home、Day View、票据、旅行材料、账本、资料和同行共享共用 suggestion / action / appliedChanges 模型
- 旅行管理：创建、查看和编辑账号旅行计划；当前版本通过设备缓存与云端对象同步实现
- Day 时间轴：按天管理景点、酒店、餐厅和交通点
- MapLibre 地图视图：用 OpenFreeMap 底图显示当天地点、编号 marker、直线顺序，可选手动生成道路路线 polyline
- 手动交通段：记录步行、公共交通、火车、飞机等方式和备注
- 外部路线跳转：用 Apple Maps / Google Maps 查看上一站到当前站的路线
- 票据管理：
  - copy：保存票据文件，可离线查看；登录后文件会作为账号票据 Blob 独立同步，已同步后可清理此设备离线缓存
  - reference：仅记录文件位置，不保存票据文件
  - external：保存外部链接，适合网盘、邮箱或订单网页
- zip 归档：导出和导入单个旅行的离线归档
- Supabase 账号数据：当前支持对象同步和恢复；下一阶段升级为 cloud-first 写入、Realtime 订阅和服务端 revision
- PWA：支持 iPhone Safari 添加到主屏幕，并缓存基础 app shell

## 🤖 AI Copilot 与行程导入

AI 是旅图的默认任务入口。当前版本已经支持全局 AI Action Gateway、AI Draft、AI Trip Edit 和一键智能修复；外部 AI 行程包继续作为兼容导入能力。

- 全局 AI：根据当前旅行上下文选择已登记动作；只读动作直接完成，写入组合计划经过一次最终确认。
- AI Draft 页面：可以粘贴 JSON 草稿、使用测试 mock，或在配置 TripMap provider proxy 后通过真实 AI provider 生成 / 修复草稿。
- 外部 AI 行程包：你也可以使用 ChatGPT、Claude、Gemini、DeepSeek 或其他工具生成符合开放格式的 `trip-plan.json` / `trip-plan.zip`，再在设置页的“导入 AI 行程包”区域本地导入。

当前实现与目标的差距：

- AI Draft 生成 / 修复只更新草稿 preview；用户点击最终“确认导入”前不会写入当前账号旅行。
- 全局 AI 已能使用受限 Place / Route / Search 能力，但完整天气、航班、铁路、票务状态和统一实时事实模型仍在路线图中。
- 真实 Provider key 只放在后端运行时环境，不进入前端 `VITE_*`、IndexedDB、zip、Supabase 或用户设置页。
- AI 行程包导入用于新建旅行，不替代完整 zip 归档恢复。
- JSON 单文件适合导入行程、坐标、交通段、reference / external 票据。
- copy 模式真实附件必须使用 zip 行程包，并把文件放在 zip 内 `files/` 目录；`filePath` 必须是 `files/` 下的安全相对路径。
- AI 可能生成错误地点、错误坐标或错误时间，导入前后都需要人工核对。
- 导入预览会区分“必须修复”和“建议检查”；有建议检查时仍可导入，但导入后应逐项核对。

文档：

- [AI 行程包开放格式](docs/AI_IMPORT_SPEC.md)
- [外部 AI 提示词模板](docs/AI_PROMPT_TEMPLATE.md)
- [AI Agent Foundation](docs/AI_AGENT_FOUNDATION.md)
- [Provider Proxy](docs/PROVIDER_PROXY.md)
- [产品战略](docs/PRODUCT_STRATEGY.md)
- [产品定位与核心体验](docs/PRODUCT_POSITIONING.md)
- [路线图 v5](docs/ROADMAP_V5.md)
- [UI V3 重构规范](docs/UI_REFACTOR_V3.md)
- [UI V3 实施计划](docs/UI_V3_IMPLEMENTATION_PLAN.md)
- [UI V3 M6 完成度审计](docs/UI_V3_M6_COMPLETION_AUDIT.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [Limited Beta 用户指南](docs/BETA_USER_GUIDE.md)
- [Limited Beta 发布说明](docs/LIMITED_BETA_RELEASE_NOTES.md)
- [Limited Beta QA 记录](docs/BETA_QA_RECORD.md)
- [trip-plan 示例](examples/README.md)

## 🧱 技术栈

- React
- Vite
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- OpenFreeMap
- Dexie.js / IndexedDB
- JSZip
- Supabase
- vite-plugin-pwa

## 🚀 本地开发

```bash
npm install
npm run dev
```

开发地址通常是：

[http://localhost:5173/#/home](http://localhost:5173/#/home)

如果示例旅行坐标显示异常，请删除旧示例旅行，或清空浏览器里的 `TravelConsoleDB` 后重新点击“创建示例旅行”。已存在于 IndexedDB 的旧示例数据不会自动更新。

## 🏗 构建和预览

```bash
npm run build
npm run preview
```

生产预览地址通常是：

[http://localhost:4173/#/home](http://localhost:4173/#/home)

## ☁️ Cloudflare Pages 部署

推荐配置：

- Framework preset：React (Vite) 或 None
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：`/`
- Environment variables：如果启用云端同步，需要配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；如果启用生产路线服务，需要配置 `VITE_ROUTE_PROXY_URL` 和 `VITE_ROUTE_PROXY_PROVIDER`，并在后端运行时配置 provider secrets。

项目使用 hash 路由，静态部署时不依赖服务器重写规则。

## ☁️ Supabase 云端同步

旅图接入 Supabase Auth 后会要求登录才能进入业务页面。产品目标是让 Supabase/Postgres 成为账号旅行事实源，并通过 Realtime 推送对象、协作和 AI job 变化。

当前版本仍处于迁移阶段：业务写入先进入账号隔离的 IndexedDB 和 outbox，再自动同步 Trip / Day / Item / TicketMeta、账本、智能状态和票据 Blob。下一阶段会改为在线写入优先、服务端 revision/ack 和 Realtime 订阅；只有网络失败时才依赖本机队列。当前冲突和恢复行为见 [Supabase 实时云端数据平台](docs/SUPABASE_CLOUD_BACKUP.md)。

需要配置：

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

账号云端数据、本机边缘缓存和 zip 归档的区别：

- 账号云端数据：目标事实源，承载跨设备、协作、AI job、票据 metadata 和操作历史。
- 本机边缘缓存：当前仍承担首写，目标架构中只负责快速启动、弱网 outbox 和应急查看。
- zip 归档：完全在此设备生成，适合按需保存到 iCloud Drive、OneDrive 或电脑。
- 云端同步：优先按对象同步 Trip / Day / Item / TicketMeta，并把 copy 票据文件同步为独立账号票据 Blob，适合换设备或清空浏览器后的恢复。
- 自动云端同步：在此设备数据变化后先拉取账号对象，再补传可安全合并的对象更新；不同对象和不同字段可合并，同一字段双边修改时会提示选择字段版本。
- 同步队列摘要：只展示还有多少对象/票据等待同步、上次同步时间和少量票据上传明细；普通用户不需要理解 snapshot 或 Storage 路径。
- 同步账号数据到此设备会更新同一 `trip.id` 的离线缓存，不创建重复旅行。
- 旧版多条云端记录和旧版恢复出的离线缓存可能仍存在；旧 `snapshot.json` 兼容路径继续可读可恢复。
- 如果新对象同步表尚未部署，应用会退回旧 snapshot 兼容同步；此时不会开放“清理已同步票据缓存”。
- 第一版未做端到端加密，护照、签证、银行卡等高度敏感文件请谨慎上传。

Supabase 建表、RLS 和 Storage policy 见 [Supabase 实时云端数据平台](docs/SUPABASE_CLOUD_BACKUP.md)。

统一旅行智能的 `appliedChanges` 与 `ignored/later/completed` 状态保存在 IndexedDB v10，并通过 `trip_intelligence_applied_change`、`trip_intelligence_suggestion_state` 跨设备同步。普通非 Operations 建议可忽略或稍后 24 小时；高风险、同步冲突和资料过期建议只能稍后。Finance 是费用草稿接收与审核端：票据和已分配旅行的 Inbox 材料只在用户确认后生成 `draft + needs_review`，不会后台扫描或自动计入结算。

Package 7、生产权限加固 migration 与 Provider D1 加固 migration 已部署。Companion 生产 RPC smoke 与真实双设备 intelligence smoke 已完整通过，覆盖设备 A 上传、设备 B 全新 IndexedDB 恢复、latest-wins 和 tombstone 删除传播。Smoke session 只缓存在仓库外并自动刷新，两个设备与 Companion 复用同一次登录，不重复发送 OTP。Provider proxy 生产路径已启用 Auth、Origin allowlist、D1 配额、每日预算和 kill switch；预算邮件在 Cloudflare 免费前提下只有可用 Email Service 绑定时发送，硬限制不依赖邮件。

## 🗺️ 实时路线与当前 Polyline

当前地图默认使用直线连接当天地点。配置 TripMap Provider Proxy 后，在地图页手动点击“生成道路路线”，旅图会按相邻地点请求道路路线 polyline。失败、超时、额度不足或交通模式不支持时，会回退显示直线。路线图 v5 会在此基础上接入出发时间、实时 ETA、交通或班次状态、来源与 TTL。

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

Provider secrets 只应配置在后端运行时，例如 Cloudflare Pages Function 的 env binding。不要把 OpenRouteService、Google Routes 或 AI provider secrets 放进 `VITE_*` 变量，也不要要求用户在设置页填写 key。浏览器可见的 Google Maps JavaScript 渲染 key 是另一类公开受限 key，应使用 referrer 限制，不能当作 server-only Routes key。

道路路线生成成功后会保存为本地路线缓存，只存在当前浏览器的独立 `TripMapRouteCacheDB` 中，不进入 zip 归档、Supabase 云端同步或 AI 行程包。下次打开同一旅行和同一天时，如果地点坐标、顺序和交通方式没有变化，地图会自动显示“本地缓存路线”；即使路线服务暂不可用，也可以查看已有缓存，但不能重新生成。修改地点坐标、顺序或交通方式后，旧路线缓存会失效并删除。设置页可以查看缓存大小、设置上限并清理缓存。

公交段会使用驾车道路路线做近似，不包含公交站点、班次、换乘和实时交通；火车、公共交通和飞机段仍使用直线 fallback。

当前道路路线不是实时导航，不包含实时交通。生成路线时会把地点坐标发送给 TripMap 路线服务及其后端 Provider。详细说明见 [实时路线与出行事实](docs/ROUTING.md) 和 [Provider Proxy](docs/PROVIDER_PROXY.md)。

## 📱 iPhone 添加到主屏幕

1. 用 Safari 打开部署地址，例如 `https://travelmap-planner.pages.dev/#/home`
2. 点击分享按钮
3. 选择“添加到主屏幕”
4. 名称可设为“旅图”

## 在线数据与安全基线

- 当前数据会先写入浏览器 IndexedDB 并自动同步；目标架构改为云端提交成功后更新本机缓存。
- IndexedDB、路线缓存和部分用户派生设置按账号隔离；首次发现旧全局数据库时可选择接管本机数据或仅恢复云端。
- copy 模式会保存票据文件，离线可查看；登录后票据文件会独立同步到账号，已同步后可清理此设备离线缓存并按需重新同步。
- reference 模式不会保存票据文件，只记录你填写的位置说明。
- external 模式只保存外部链接。
- AI、搜索、路线和地点请求统一经过 Provider Proxy；只读查询自动执行，写入按风险进入一次组合确认或独立高风险确认。
- 道路路线仅在用户手动点击生成时请求第三方路线服务，并会发送相邻地点坐标；Provider proxy 会先验证登录态、Origin、IP/账号/全局配额和 kill switch。
- 道路路线缓存只保存在当前浏览器本机，不进入云端同步，也不进入 zip 归档。
- 清除浏览器数据、私密浏览、系统存储压力或长期未使用都可能导致此设备离线缓存丢失。
- zip 归档是高级/迁移工具；重要旅行也可以按需导出并保存到 iCloud Drive、OneDrive 或电脑。
- 安全、数据最小化和密钥隔离由后端合同强制，普通用户不需要在首页管理技术性隐私开关。

## 📦 zip 归档说明

zip 归档包含：

- 旅行信息
- Day 列表
- 行程点、坐标和交通段
- 票据元数据
- copy 模式票据文件

reference / external 模式不会包含实际文件内容，只会保留位置说明或外部链接。可以在设置页导入 zip 归档恢复旅行。

道路路线缓存不会进入 zip 归档。恢复旅行后如需道路路线，需要重新生成，或依赖当前浏览器已有的匹配本地缓存。

## ⚠️ 当前限制

- 道路路线 polyline 不是实时导航，不提供语音导航、turn-by-turn 指令或实时交通。
- 不自动计算交通时间。
- 地点查找是单个行程点的手动候选流程，确认后才写入；不是批量地理编码或自动 enrich。
- 地图底图依赖 OpenFreeMap 网络加载。
- PWA 无法可靠保存并直接打开本地文件真实路径。
- iOS Safari 对 IndexedDB 存储有系统策略限制。
- Supabase 云端同步不是实时协作；同一字段可能双向修改时需要用户手动选择。
- 上一条是当前版本限制；路线图 v5 将升级为 cloud-first 写入、Realtime 订阅和服务端版本冲突合同。
- PWA 更新后可能需要刷新或关闭重开；出发前请导出 zip 备份。

## 项目状态

当前产品阶段从“本机先写、账号同步”的稳定基线迁移到“实时在线、AI 优先”。用户在 Trip Home、Day View、票据和账本上下文里可以直接要求 AI 完成任务；后续版本会让云端状态、实时 Provider 事实和异步 AI job 成为默认主路径。PWA app shell、IndexedDB 和 zip 归档继续作为可靠性与迁移能力。

设计原则：轻量化不是删内容，而是更清楚的信息层级、更少空壳、更自然的分组。

当前路线图与阶段状态见：

- [项目状态](docs/PROJECT_STATUS.md)
- [产品战略](docs/PRODUCT_STRATEGY.md)
- [路线图 v5](docs/ROADMAP_V5.md)
- [UI V3 重构规范](docs/UI_REFACTOR_V3.md)
- [UI V3 M6 完成度审计](docs/UI_V3_M6_COMPLETION_AUDIT.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [历史路线图 v4](docs/ROADMAP_V4.md)

## License

License 尚未指定。
