# 旅图 TripMap 项目状态

更新时间：2026-05-24
基线：Phase 12E 后，视觉完整性纠偏、全页表单布局修复、AI Privacy Guard、AI draft real provider adapter、AI draft repair guardrails、search provider proxy foundation、AI trip edit patch plan foundation、cloud save wording 和 E2E locator hardening 均已完成。

Limited beta readiness checklist: [docs/LIMITED_BETA_READINESS.md](LIMITED_BETA_READINESS.md).

## 当前定位

旅图是 local-first 出国旅行 PWA。核心数据保存在浏览器 IndexedDB；zip 和 Supabase 都是备份 / 恢复层，不替代本地数据源。

它不是订票软件、完整导航软件、实时同步产品或多人协作工具。AI 与地图服务只做辅助，最终写入仍应由用户确认。

## 当前 canonical routes

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

已完成的路由拆分语义：

- `#/trip`：Trip Home，旅行级总览与入口。
- `#/day`：Day View，承载 schedule / map 切换和当前 Day 的日程、地图。
- `#/item`：Item Detail 独立页面。
- `#/tickets`：票据库。
- `#/settings`：设置、备份、导入与 provider 配置。

## 已完成能力

- local-first PWA 与 IndexedDB 数据模型。
- Trip Home / Day View / Item Detail 路由拆分。
- Trip / Item 新建编辑独立页面。
- MapLibre 地图、OpenFreeMap 底图、编号 marker、直线连接。
- 手动道路路线 polyline，失败时回退直线。
- 本地路线缓存 `TripMapRouteCacheDB`，缓存自动加载、失效和清理。
- 地图 collapsed sheet 轻量化第一轮、route chip、route controls、公交近似提示。
- 票据 copy / reference / external 三模式。
- 完整 zip 备份导出 / 导入。
- AI trip-plan JSON / zip 导入，含 copy 附件和本地校验预览。
- AI Draft 页面：本地 mock 草稿、手动 JSON 草稿、provider proxy 真实草稿生成、草稿质量检查和 AI repair preview flow。
- Trip Home AI 修改建议：一次性用户指令 → 脱敏 saved-trip context → provider proxy patch plan → 本地校验 → diff preview → 二次确认后本地事务 apply。
- AI Privacy Guard：AI 生成 / 修复请求前按隐私设置过滤数据，默认不发送 notes、票据、cloud、route cache 或完整本地 DB。
- DeepSeek `deepseek-v4-flash` real provider smoke：generation 和 repair 均通过 `/api/provider-proxy` 跑通，key 保持 server-side。
- Supabase 手动云端保存 / 原地恢复。
- 自动云端保存基础。
- PWA 启动云端保存检查。
- 冲突感知云端提示：本地较新、云端较新、可能冲突时只显示非阻塞提示。
- Playwright 移动端 E2E 与 Vitest 单元测试。

## 已完成阶段

- Phase 11.6：Map-first collapsed sheet redesign。
- Phase 12-pre-A/B：恢复有用标签、简化 Trip 更多菜单。
- Phase 12-pre-C：full-page create/edit routes。
- Phase 12-pre-D：Trip Home / Day View 拆分计划。
- Phase 12-pre-E：拆分准备与共享数据加载。
- Phase 12-pre-F：导航回归检查。
- Phase 12A：自动云端保存基础。
- Phase 12B：启动云端保存检查。
- Phase 12C：冲突感知云端提示。
- Phase 12E：视觉完整性纠偏与全页表单布局修复。
- AI draft foundation / request builder / provider proxy operation / real provider adapter / privacy guard / repair guardrails。
- Search provider proxy foundation / AI trip edit patch plan foundation。
- E2E locator hardening。

## 不要误判为完成

- Trip Home 还缺全旅行地图概览与更清晰入口。
- Day View 的 marker-card interaction 尚未完成：目标是点击 marker 出现轻量卡片，再进入 Item Detail。
- Item Detail 仍需变成旅行现场查看页，而不是普通信息页。
- Ticket Library 仍需从文件列表升级为票据画廊。
- SwiftUI-like / iOS grouped list 设计系统尚未沉淀。
- 时区与日期语义审计待做。
- Web search 虽已可通过 server-side Tavily env 接入，但仍只允许 AI Trip Edit 在明确搜索意图且用户确认后单次调用 `travel_search`；没有 source-bearing 结果就不声明实时信息。
- Google Places item lookup 是手动、单行程点、确认后写入的 foundation；不是自动 enrich、批量更新、路线生成或地点详情全量同步。
- AI thinking / reasoning 不做用户开关：当前由后端策略管理，默认保持 stable JSON mode，优先稳定结构化输出。
- AI trip edit 是 patch plan + explicit search tool foundation：不是多轮聊天助手，不自主浏览网页，不自动应用修改，不联动 route/ticket/cloud。

## 云端与同步状态

- Supabase 用于账号登录后的单旅行云端保存和恢复。
- 从当前版本开始，一个本地 `trip.id` 对应一个云端保存；同一用户的同一 `trip.id` 使用稳定 `backupId`，手动上传会覆盖同一个云端保存，包含旅行结构化数据和 copy 模式票据附件。
- 自动云端保存默认关闭；开启后在本地 Trip / Day / Item / Ticket 变更成功后延迟覆盖同一个云端保存。
- 启动、恢复在线或登录变化时会比较本地版本信号与最新云端保存 metadata，并补偿本地更新、缺失云端保存或遗留上传中状态。
- 云端版本较新时会提示使用云端版本覆盖同一 `trip.id` 的本地旅行；本地版本较新时会上传本地版本并覆盖同一个云端保存；可能双向修改时要求用户选择用本地覆盖云端或用云端覆盖本地。
- 旧版多条云端记录和旧版恢复出的本地副本可能仍存在；当前版本不会自动迁移、合并、删除或清理这些历史数据。
- 删除本地旅行不会删除云端保存；删除云端保存必须走手动确认。
- 当前不是实时表同步，不做字段级合并、实时协作或云端删除同步。

## 数据与缓存边界

- IndexedDB 是主数据源。
- 旅行日期 / 时间语义见 `docs/TIMEZONE_AUDIT.md`：当前保持 `YYYY-MM-DD` plain date 与 `HH:mm` 本地墙上时间。
- 完整 zip 备份包含旅行、Day、Item、票据元数据和 copy 文件内容。
- 路线缓存只保存在当前浏览器本机，不进入 zip、Supabase 或 trip-plan。
- Server-only OpenRouteService / Google Routes / AI provider / Tavily / Google Places secrets 不进入前端 bundle、IndexedDB、zip、Supabase 或 trip-plan；浏览器可见的 Google Maps JS 渲染 key 只能作为公开受限 key 使用。
- AI trip-plan 导入创建新旅行，不覆盖已有旅行。
- AI draft generation / repair 只生成或修复草稿 preview；用户必须核对地点、坐标、交通时间和票据，并在最终导入前确认。
- AI trip edit plan 不直接写库；只允许 granular 白名单 operations（item title/time/location/note/transport、add/remove/move/reorder、day title），预览后必须二次确认才写入 IndexedDB。应用前会重新读取本地状态并拒绝 stale preview；删除 ticket-bound item 会被拒绝，不删除或解绑票据。
- AI provider 请求只通过 `/api/provider-proxy`；server-only AI key 不进入前端 bundle、用户设置页、IndexedDB、zip、Supabase、日志或报告。
- AI repair 使用当前草稿、质量检查结果和隐私过滤后的数据；不读取票据图片/PDF/OCR，不搜索网页，不直接修改已保存旅行。
- 不缓存商业地图瓦片，不通过 PWA service worker 做瓦片离线缓存。

## AI Provider 与 Repair 状态

- Real AI draft generation：DeepSeek `deepseek-v4-flash` 通过 OpenAI-compatible provider proxy smoke passed。
- Real AI draft repair：DeepSeek `deepseek-v4-flash` 通过 `/api/provider-proxy` smoke passed；用户确认后触发一次 repair 请求，修复草稿返回并更新 preview / JSON textarea。
- Validation path：provider raw text → JSON extraction → `validateAiTripDraft` → preview。最终“确认导入”前不写 IndexedDB。
- AI trip edit plan：`ai_trip_edit_plan` 已接入 provider proxy。上下文由 AI Privacy Guard 约束，默认不发送 notes、完整坐标、ticket IDs/文件/blob、cloud、route cache 或完整本地 DB；明确搜索意图可在发送确认后先调用一次 `travel_search` 并附加最多 3 条来源摘要。返回走 JSON extraction → `validateAiTripEditPatchPlan` → 本地推导 affected IDs/counts → diff preview → stale baseline check → final confirm → IndexedDB transaction apply。
- Side-effect boundary：repair 前后没有 route generation/cache、ticket creation、cloud upload/delete 或 sortOrder optimization。
- Security check：page/dist/report 不应包含 API key、key prefix、Bearer header、raw provider body、raw model output、full prompt 或 stack trace。
- DeepSeek reasoning：当前由后端策略管理。默认、simple 和 `auto` 路径发送 `thinking: { type: "disabled" }`；复杂任务可由后端选择 high reasoning。前端没有 Settings selector、AI Draft selector、search toggle 或 localStorage 模式开关。
- Web search：`travel_search` provider proxy 支持 mock/disabled/Tavily，真实 Tavily key 只在服务端 env 中使用，结果归一化为 title、URL、displayUrl、domain、snippet、retrievedAt、sourceType、confidence，并受独立 `search|` quota 约束。AI Trip Edit 可在用户确认后单次调用 search；AI draft generation / repair 不会调用 search。AI 不得在没有 sourced search results 时声称知道实时营业时间、票价、闭馆、交通中断、近期评价或活动。
- Google Places lookup：`place_lookup` provider proxy 支持 mock/disabled/google_places，使用 server-only `TRIPMAP_GOOGLE_PLACES_API_KEY` 和严格 FieldMask `places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri`。Item Detail 的“查找地点信息”只发送 visible item title/location/address 组成的 query，候选结果临时展示，确认后只更新当前 item 的 `locationName`、`address` 和有效 `lat/lng`；`googleMapsUri` 持久化、opening hours、ratings、reviews、photos、phone、website deferred。

## 本地 QA 注意事项

- `wrangler pages dev` / Workerd 可能受 shell `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 影响。若 direct DeepSeek 检查健康但本地 provider proxy repair 间歇性 `network_error` / timeout，先用 unset proxy env 的 wrangler 进程重测。
- PWA service worker 可能在本地 QA 时提供旧 bundle。若页面行为和最新 build 不一致，先 unregister service worker、clear site data、hard refresh。
- `.env.local` 和 `.dev.vars` 必须保持 gitignored，不得提交。报告不得包含真实 key、key prefix、raw provider body、full prompt 或 raw model output；如任何 key prefix 曾被复制进聊天或日志，应 rotate key。

## 下一步建议

优先执行 `docs/ROADMAP_V4.md` 中的后续阶段：

1. 时区与日期语义审计（Phase 12F）。
2. Trip Home 地图概览与入口优化（Phase 13A）。
3. Day View marker-card interaction（Phase 13B）。
4. AI durable quota、backend reasoning policy evolution、search provider proxy 和 AI trip edit agent。

在时区审计完成前，不建议继续推进 Map Provider 或 Transit Hints 等新能力。AI 新能力应先补 durable quota，并继续保持 provider proxy / confirmation boundary；reasoning 和 search 由后端能力演进，不做用户可见模型控制。
