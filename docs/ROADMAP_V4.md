# 旅图 TripMap 路线图 v4

本文档以 `/Users/ysradmin/Downloads/tripmap_future_design_direction_v4.md` 为新版产品方向来源，取代旧版“13 条产品修正”的整理方式。v4 的核心判断是：旅图接下来不是继续堆新功能，而是先修正前几轮 AI 改动带来的设计偏差。

## 核心纠偏

- 轻量化不是删内容。必要信息要保留，空壳 card、chip、分栏和无意义留白要删除。
- 独立页面不等于表单完成。新建 / 编辑页面需要继续做移动端布局、重叠、错误提示和键盘场景 QA。
- 路由拆分不等于交互完成。Trip Home / Day View / Item Detail 已拆开，但 Day View 仍未完成理想的“marker → 轻卡片 → Item Detail”地图交互。
- 继续保持离线可用、本机先落盘。IndexedDB 是此设备离线缓存与首写层；Supabase 优先做旅行对象同步和票据 Blob 同步，不是实时表同步。
- AI 和地图 API 只做辅助。AI draft generation / repair 只更新草稿 preview，用户确认后才写入；server-only provider keys 通过后端 proxy 保存；不缓存商业地图瓦片。

## 已完成基线

- Phase 11.6：地图 collapsed sheet 轻量化第一轮完成。
- Phase 12-pre-A/B：Home / Overview 有用标签恢复，Trip 更多菜单简化完成。
- Phase 12-pre-C：Trip / Item 新建编辑独立页面完成。
- Phase 12-pre-D：Trip Home / Day View 拆分实施计划完成。
- Phase 12-pre-E：共享数据加载与路由拆分铺垫完成。
- Phase 12-pre-F：Trip Home / Day View / Item Detail 导航回归检查完成。
- Phase 12A：自动云端同步基础完成。
- Phase 12B：PWA 启动云端同步检查完成。
- Phase 12C：冲突感知云端提示与操作链路完成。
- Phase 12E：视觉完整性纠偏与全页表单布局修复完成。
- AI draft request builder、provider proxy operation、DeepSeek real provider smoke、AI Privacy Guard、AI repair guardrails、search provider proxy foundation、AI trip edit patch plan foundation 完成。
- E2E locator hardening 完成。
- Unified Trip Intelligence Packages 1-7 完成：统一建议/动作/完成记录、Trip Home 收敛、Day/Live、Ticket/Inbox/Finance、Document/Shared Trip、IndexedDB v10 与跨设备对象同步。
- Finance 接收端改造完成：移除后台来源扫描，Ticket/Inbox 费用证据必须确认后生成 `draft + needs_review`。
- Package 7、生产权限加固与 Companion owner policy 前向修复已部署；Companion 与真实双设备生产 smoke 完整通过，覆盖 A 上传、B 全新恢复、latest-wins 与 tombstone 传播。
- PR1-PR3 Limited Beta 基础收口完成：全局登录与账号隔离、Phase 12F 时间语义、Provider 生产运营加固均已进入主线；Provider D1 migration、Pages env、maintenance Worker 和 production smoke 已完成。
- PR4 QA/文档/治理分支新增桌面 1440x900 smoke、真实构建 PWA 升级 smoke、Beta 用户指南、发布说明、QA 记录和 PR 模板。
- Phase 13A：Trip Home 全程地图概览入口优化完成第一轮，地图预览下方提供按天坐标覆盖、Day Map 入口和首个有坐标地点入口。

当前 canonical routes：

```text
#/home
#/trip?tripId=...
#/day?tripId=...&dayId=...&view=schedule|map
#/item?tripId=...&dayId=...&itemId=...
#/trip/new
#/trip/edit?tripId=...
#/item/new?tripId=...&dayId=...
#/item/edit?tripId=...&dayId=...&itemId=...
#/tickets
#/settings
#/ai-draft
```

## 不要误判为完成

- Trip Home 主建议层级已收敛；全旅行地图概览入口已完成第一轮，后续可继续做视觉 QA 和更丰富地图 provider 能力。
- Day View 已有 marker card 初版；后续仍需把 marker → 轻卡片 → Item Detail 现场路径做得更顺。
- Item Detail 仍需变成旅行现场查看页。
- Ticket Library 已升级为票据画廊并接入当前票据建议；完整票据编辑器仍未实现。
- SwiftUI-like / iOS grouped list 风格还没有形成系统规范。
- Phase 12F 时间语义已完成第一轮收口：PlainDate、WallClockTime、Instant、IANA 时区、DST 自动校正、Trip/Day/Item timezone、跨时区 item range、selected-day / Trip status 和 cloud version timestamp guardrails 已进入主路径。后续功能必须复用这些边界，未来仍需 AI ISO datetime 显式确认和跨国家高级 UI。
- AI reasoning 不做用户开关：当前由后端策略自动选择，默认保持 stable JSON mode。
- AI web search 尚未实现：当前不查询实时营业时间、票价、交通、天气、评价、活动或网页来源。
- AI trip edit 当前只是 patch plan foundation：不是多轮聊天助手，不联网搜索，不自动应用修改，不联动 route/ticket/cloud。

## 后续路线图

### 1. Trip / Day / Item / Ticket UX completion

- Phase 12D：Home 与全局视觉纠偏。✅ 已完成。
- Phase 12E：Full-page form 布局修复与输入体验 QA。✅ 已完成。
- Phase 13A：Trip Home 地图概览与入口优化。✅ 已完成第一轮。
- Phase 13B：Day View 地图点卡片交互。点击 marker 显示轻量卡片，点击卡片进入 Item Detail。
- Phase 14A：Item Detail 2.0。面向现场查看，突出时间、地点、交通、票据与外部导航。
- Phase 16A/B/C：Ticket Library 2.0、全屏票据预览器、Item Detail 票据紧凑展示。

### 2. SwiftUI-like design system

- Phase 15A：建立 `docs/DESIGN_SYSTEM.md`。
- 方向：iOS / SwiftUI grouped list、自然 section header、少卡片套卡片、少装饰 chip、按钮层级清楚。
- 目标：去 AI 味，让后续页面有一致的 spacing、radius、shadow、warning、sheet 和 form 规范。

### 3. Map UX

- Phase 17A：一键回到行程范围与用户位置。
- Phase 17B：marker / route line 缩放适配。
- Phase 17C：emoji / category marker foundation。
- 边界：不重写 MapLibre 生命周期，不破坏 route chip、route cache、ORS fallback、bottom sheet snap。

### 4. Map provider / cache

- Phase 18A：Map Provider Foundation。
- 建立底图、地点搜索、geocoding、routing provider 和 key management 分层。
- 可缓存用户确认坐标、placeId、简化候选和 route polyline；不缓存商业地图瓦片、Google 原始完整响应或大量自动预取数据。

### 5. Import route generation

- Phase 19A：Import Route Generation Queue。
- AI / zip 导入后只提示用户生成路线，不静默消耗 API。
- 生成结果写入本地 route cache，不进入 zip、Supabase 或 trip-plan schema。

### 6. AI-native travel intelligence

- Phase 20A：AI Trip Generation / Repair Provider Baseline。✅ 已完成基础接入。
- Unified Trip Intelligence 基础与上下文接入已完成；后续执行扩展必须复用统一 executor / appliedChanges，不为 Ledger、Document 或 Shared Trip 新建平行中心。
- 当前可用：本地 mock、真实 provider generation、草稿质量检查、真实 provider repair、AI Privacy Guard、ConfirmDialog write boundary、AI trip edit patch plan preview/apply foundation。
- 当前限制：不接入真实 web search，不提供 thinking mode UI 或搜索开关，不读取票据图片/PDF/OCR，不做多轮 AI chat，不自动编辑已保存旅行。`travel_search` 仅为 mock/disabled foundation，不是实时来源。
- AI draft 只生成 / 修复 draft preview；AI trip edit 只生成 patch plan preview。地点、坐标、路线、交通时间、票据绑定和本地写入必须由用户确认。

### 7. AI-first future work

#### Backend Reasoning Policy Evolution

- 不做用户可见的模型控制开关；用户只表达旅行意图，后端按任务复杂度选择处理方式。
- 默认保持 fast / stable JSON mode，优先结构化输出和低延迟。
- 复杂任务可由后端自动提升 reasoning 强度，并在 provider proxy 内保持 provider-specific request shape。
- 若未来需要向用户提示成本或耗时，应以任务级提示表达，不暴露 provider 参数或 AI key。

#### Search Provider Proxy Foundation

- Web search 必须是独立 provider proxy operation，不混入 draft repair。
- 当前 `travel_search` foundation 已保留合同和独立 `search|` quota，但默认无真实 provider 时返回 `provider_unavailable`；mock mode 仅返回 example 域名模拟结果。
- 未来真实 provider 返回内容需要 title、URL、displayUrl、domain、snippet、retrievedAt、sourceType、confidence 和摘要。
- UI 必须展示来源和时间，不能把实时营业时间、票价或交通状态伪装成模型常识。
- 搜索请求和 AI 请求应有独立 quota、normalized errors 和 no-secret boundary。

#### AI Trip Edit Agent

- Foundation 已实现：用户用自然语言说明如何修改已保存旅行，AI 输出 patch / diff，而不是直接写 IndexedDB。
- Patch 必须经过 schema validation、冲突检查、预览和二次用户确认。
- 当前只支持 granular 白名单操作：item title/time/location/note/transport、add/remove/move/reorder、day title。
- 默认不得读取 notes、坐标、票据图片/PDF/OCR、ticket filename/blob、cloud token/status、route cache、provider key、URL 或完整本地 DB。
- 后续再评估 richer diff、undo/history、search-assisted edits 和多轮 chat；这些都不能绕过 preview/confirm write boundary。

#### Durable Quota And Abuse Controls

- D1-backed provider quota 和生产加固已实现：生产/可信预览按 method/body size、Origin、edge IP、Bearer、Supabase Auth、kill switch、D1 quota、provider 的顺序处理。
- 已启用账号/IP/全局 daily budgets，preview 使用 25% 独立 namespace，`provider_controls` 可即时关闭 `global`、`ai`、`search`、`place`、`route`、`fx`。
- `tripmap-provider-maintenance` hourly cron 已部署，负责清理过期 minute rows、8 天前 daily rows、30 天前 alert rows，并恢复过期自动预算控制。
- Cloudflare 免费前提下未配置可发送 Email Service 时，预算告警保留 pending 记录；100% 硬限制和 kill switch 不依赖邮件。

## 长期边界

- 用户可见文案保持中文。
- IndexedDB 仍是此设备离线缓存与首写层。
- 旅行日期 / 时间语义遵循 `docs/TIMEZONE_AUDIT.md`；基础 timezone 字段已存在，后续不要新增半套字段、自动回填历史数据或静默截断 ISO datetime。
- Supabase 是账号数据同步，不是实时表同步；当前优先同步 Trip / Day / Item / TicketMeta 对象和 copy 票据 Blob。
- 同步采用 pull-before-push 增量对象同步；不同对象和不同字段可自动合并，同一字段双边修改时提示用户选择字段版本。
- 设置页只做轻量同步队列摘要和登录后同步方向提示，不暴露 snapshot 路径或 Storage 细节。
- 旧版多条云端记录、旧 `snapshot.json` 和旧版恢复出的离线缓存可能仍存在；保留为兼容与迁移路径。
- zip 归档是可选离线归档能力。
- 长期同步路线见 `docs/SUPABASE_CLOUD_BACKUP.md`：对象同步、票据 Blob 独立上传、字段级冲突面板和轻量队列摘要已进入主路径；后续仍需设备/操作审计、队列调试工具和协议迁移工具。
- OpenRouteService / Google Routes / AI provider secrets 只放在后端运行时环境，不进入前端 bundle、IndexedDB、zip、Supabase 或 trip-plan。浏览器可见的 Google Maps JS 渲染 key 必须按 referrer 限制。
- DeepSeek `deepseek-v4-flash` 当前用于真实 AI draft generation / repair smoke；reasoning 由后端策略管理，默认保持 stable JSON mode，不提供用户开关。
- 当前 AI 不能把搜索当作模型常识。`travel_search` 可以在 server-side Tavily env 可用时作为来源化搜索 provider，但仅限用户确认后的单次辅助流程；没有来源就不得声称知道实时营业时间、票价、闭馆、交通中断、近期评价或活动。
- 不缓存商业地图瓦片，不修改 PWA service worker 做瓦片离线缓存。
- 390px 移动端宽度是基础验收线。
- 1440x900 桌面 Beta smoke 和真实构建 PWA 升级 smoke 是新增 QA 基线；实体机 Safari/Android 检查需要人工记录。
