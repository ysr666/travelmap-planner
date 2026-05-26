# 旅图 TripMap 路线图 v4

本文档以 `/Users/ysradmin/Downloads/tripmap_future_design_direction_v4.md` 为新版产品方向来源，取代旧版“13 条产品修正”的整理方式。v4 的核心判断是：旅图接下来不是继续堆新功能，而是先修正前几轮 AI 改动带来的设计偏差。

## 核心纠偏

- 轻量化不是删内容。必要信息要保留，空壳 card、chip、分栏和无意义留白要删除。
- 独立页面不等于表单完成。新建 / 编辑页面需要继续做移动端布局、重叠、错误提示和键盘场景 QA。
- 路由拆分不等于交互完成。Trip Home / Day View / Item Detail 已拆开，但 Day View 仍未完成理想的“marker → 轻卡片 → Item Detail”地图交互。
- 继续保持 local-first。IndexedDB 是主数据源；Supabase 是单旅行云端保存，不是实时表同步。
- AI 和地图 API 只做辅助。AI draft generation / repair 只更新草稿 preview，用户确认后才写入；server-only provider keys 通过后端 proxy 保存；不缓存商业地图瓦片。

## 已完成基线

- Phase 11.6：地图 collapsed sheet 轻量化第一轮完成。
- Phase 12-pre-A/B：Home / Overview 有用标签恢复，Trip 更多菜单简化完成。
- Phase 12-pre-C：Trip / Item 新建编辑独立页面完成。
- Phase 12-pre-D：Trip Home / Day View 拆分实施计划完成。
- Phase 12-pre-E：共享数据加载与路由拆分铺垫完成。
- Phase 12-pre-F：Trip Home / Day View / Item Detail 导航回归检查完成。
- Phase 12A：自动云端保存基础完成。
- Phase 12B：PWA 启动云端保存检查完成。
- Phase 12C：冲突感知云端提示与操作链路完成。
- Phase 12E：视觉完整性纠偏与全页表单布局修复完成。
- AI draft request builder、provider proxy operation、DeepSeek real provider smoke、AI Privacy Guard、AI repair guardrails、search provider proxy foundation、AI trip edit patch plan foundation 完成。
- E2E locator hardening 完成。

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

- Trip Home 还不是完整旅行首页：全旅行地图概览和入口层级仍待做。
- Day View 还没有完成 marker-card interaction：当前仍以 sheet 为主，理想形态是 marker 触发轻卡片，再进入 Item Detail。
- Item Detail 仍需变成旅行现场查看页。
- Ticket Library 仍偏文件列表，还不是票据画廊。
- SwiftUI-like / iOS grouped list 风格还没有形成系统规范。
- 时区与日期语义审计待做：formatVersionTimestamp 等时间处理需复查。
- AI reasoning 不做用户开关：当前由后端策略自动选择，默认保持 stable JSON mode。
- AI web search 尚未实现：当前不查询实时营业时间、票价、交通、天气、评价、活动或网页来源。
- AI trip edit 当前只是 patch plan foundation：不是多轮聊天助手，不联网搜索，不自动应用修改，不联动 route/ticket/cloud。

## 后续路线图

### 1. Trip / Day / Item / Ticket UX completion

- Phase 12D：Home 与全局视觉纠偏。✅ 已完成。
- Phase 12E：Full-page form 布局修复与输入体验 QA。✅ 已完成。
- Phase 13A：Trip Home 地图概览与入口优化。Trip Home 成为真正旅行首页，而不是纯 overview。
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

### 6. AI-native PWA

- Phase 20A：AI Trip Generation / Repair Provider Baseline。✅ 已完成基础接入。
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

- D1-backed provider quota foundation 已实现：生产绑定 `TRIPMAP_PROVIDER_QUOTA_D1` 后使用 durable quota，本地/dev 无 binding 时使用内存 fallback。
- 结合 session、IP 和 server-observed signals；account slot 保留给后续登录态配额。
- 保持 route、travel search、place lookup、AI generation、AI repair 和 AI trip edit 的 quota namespace 隔离。
- Public beta 前仍需要 D1 migration/binding smoke、origin allowlist、billing / abuse protection、expired-row cleanup job 和近生产 Cloudflare smoke。

## 长期边界

- 用户可见文案保持中文。
- 本地 IndexedDB 仍是主数据源。
- 旅行日期 / 时间语义遵循 `docs/TIMEZONE_AUDIT.md`；在 schema 设计完成前不要新增半套 timezone 字段。
- Supabase 是手动 / 自动单旅行云端保存，不是实时表同步。
- 从当前版本开始，一个本地 `trip.id` 对应一个云端保存；上传会覆盖该旅行的云端保存。
- 云端版本较新时使用云端版本覆盖本地，本地版本较新时用本地覆盖云端；可能冲突时提示用户确认方向，不做自动合并。
- 旧版多条云端记录和旧版恢复出的本地副本可能仍存在；不自动迁移、合并、删除或清理。
- 本地 zip 备份仍然重要。
- OpenRouteService / Google Routes / AI provider secrets 只放在后端运行时环境，不进入前端 bundle、IndexedDB、zip、Supabase 或 trip-plan。浏览器可见的 Google Maps JS 渲染 key 必须按 referrer 限制。
- DeepSeek `deepseek-v4-flash` 当前用于真实 AI draft generation / repair smoke；reasoning 由后端策略管理，默认保持 stable JSON mode，不提供用户开关。
- 当前 AI 不联网搜索。`travel_search` 只是未来真实搜索的结构槽位，当前成功 runtime source 仅限 mock。未来 web search 必须显示来源、retrievedAt 和置信度，并通过独立 provider proxy operation 调用；AI 不得在没有搜索来源时声称知道实时营业时间、票价、闭馆、交通中断、近期评价或活动。
- 不缓存商业地图瓦片，不修改 PWA service worker 做瓦片离线缓存。
- 390px 移动端宽度是基础验收线。
