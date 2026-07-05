# 旅图 TripMap 项目状态

更新时间：2026-07-05
基线：Unified Trip Intelligence Packages 1-7、全局登录与账号数据隔离、Phase 12F 时间语义、Provider 生产运营加固已完成。PR4 分支新增桌面 Beta smoke、真实构建 PWA 升级 smoke、Beta 用户指南、发布说明、QA 记录和 PR 治理模板。Phase 13A Trip Home 地图概览入口优化、Phase 13B Day Map marker 卡片交互、Phase 13C 全局 AI 咨询分流、Phase 14A Item Detail 现场行动区和 Phase 16A Ticket Library 现场筛选完成第一轮。

Limited beta readiness checklist: [docs/LIMITED_BETA_READINESS.md](LIMITED_BETA_READINESS.md).
Foundation/Phase-2 roadmap, including the original 13 product directions mapping: [docs/FOUNDATION_GAP_REVIEW_PHASE2.md](FOUNDATION_GAP_REVIEW_PHASE2.md).

## 当前定位

旅图是产品化阶段的出国旅行管理工具，目标是用 Trip Home、Day View、票据、账本和共享旅行等上下文回答“现在要确认什么 / 现在该做什么”。核心数据仍先写入浏览器 IndexedDB；离线可用、PWA app shell、Supabase 账号同步和 zip 归档是底层能力，而不是主产品叙事。业务页面需要登录，已联网验证设备获得 30 天离线访问期，退出登录会关闭当前账号数据空间。

它不是订票软件、完整导航软件或实时搜索产品。账号云同步仍是单账号对象同步，不是多人云端编辑；Shared Trip 已提供同行动态实时刷新、成员资料、按人票据授权与原件访问审计、主人本地更新自动发布、普通同行修改自动处理和需判断请求的主人确认流。AI 与地图服务只做辅助，最终写入仍应由用户确认。

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
#/ledger?tripId=...
#/settings
#/ai-draft
```

已完成的路由拆分语义：

- `#/trip`：Trip Home，旅行级总览与入口。
- `#/day`：Day View，承载 schedule / map 切换和当前 Day 的日程、地图。
- `#/item`：Item Detail 独立页面。
- `#/tickets`：票据库。
- `#/ledger`：主人个人旅行账本，包含明细、预算、参与人和结算。
- `#/settings`：设置、同步、归档导入与 provider 配置。

## 已完成能力

- 产品化旅行管理体验与 IndexedDB 本地数据底座。
- Supabase AuthGate：未登录不能进入业务页面，保留登录前目标路由；账号验证后支持 30 天离线访问期。
- 账号数据隔离：`TravelConsoleDB`、路线缓存和用户派生本地状态按账号 hash 分区；旧全局库可接管到账号库或保留为只读备份后仅恢复云端。
- Trip Home / Day View / Item Detail 路由拆分。
- Trip Home 全程地图概览：显示全旅行地图预览、按天坐标覆盖、Day Map 入口和首个有坐标地点入口，不自动调用 provider。
- Trip / Item 新建编辑独立页面。
- MapLibre 地图、OpenFreeMap 底图、编号 marker、直线连接。
- Day Map marker 卡片：点击 marker 或站点 rail 显示轻量现场卡片，可上一/下一站、查看详情并保留地图来源上下文。
- Item Detail 现场行动区：详情页顶部整合时间、前后站、路线到这里、打开地点、坐标状态和绑定票据入口，仍不自动调用 provider。
- Ticket Library 现场筛选：票据总览数字可直接筛选保存文件、仅记录位置、外部链接、此设备离线可用、未分类和全部票据，预览器沿用筛选后的线性上下文。
- Shared Trip 同行协作：同行动态实时刷新；主人可维护同行资料库，按成员分配票据与原件授权，同行只看到被授权内容，指定名单为空表示不共享给任何同行；票据原件授权、撤销和打开请求进入主人审计列表；主人本地更新会在已开启共享后自动发布，普通同行修改自动进入主人端处理流并回写共享视图，撤销重排等需判断请求保留主人确认。
- 手动道路路线 polyline，失败时回退直线。
- 本地路线缓存 `TripMapRouteCacheDB`，缓存自动加载、失效和清理。
- 地图 collapsed sheet 轻量化第一轮、route chip、route controls、公交近似提示。
- 票据 copy / reference / external 三模式。
- 完整 zip 归档导出 / 导入。
- AI trip-plan JSON / zip 导入，含 copy 附件和本地校验预览。
- AI Draft 页面：本地 mock 草稿、手动 JSON 草稿、provider proxy 真实草稿生成、草稿质量检查和 AI repair preview flow。
- Trip Home AI 修改建议：一次性用户指令 → 脱敏 saved-trip context → provider proxy patch plan → 本地校验 → diff preview → 二次确认后本地事务 apply。
- 全局 AI 输入：普通问答进入本地只读咨询，本地重排 / 偏好 / 账本走确认或摘要，明确修改才进入 provider-backed patch plan。
- AI Privacy Guard：AI 生成 / 修复请求前按隐私设置过滤数据，默认不发送 notes、票据、cloud、route cache 或完整本地 DB。
- DeepSeek `deepseek-v4-flash` real provider smoke：generation 和 repair 均通过 `/api/provider-proxy` 跑通，key 保持 server-side。
- Provider proxy production hardening：生产/可信预览先拒绝无 Origin 或非 allowlist Origin，再做 IP 限流、Bearer 检查、Supabase Auth 验证、D1 kill switch、每日预算和 operation 分钟配额，最后才调用 provider。
- Supabase 对象同步 / 原地恢复。
- copy 票据 Blob 独立云端记录与此设备离线缓存管理。
- 自动云端同步基础。
- PWA 启动云端同步检查。
- 冲突感知云端提示：本地较新、云端较新、可能冲突时只显示非阻塞提示。
- Playwright 移动端 E2E 与 Vitest 单元测试。
- Trip Home 旅行账本：双币种、整数最小货币单位、费用草稿、预算提醒、同行分摊、历史汇率快照、重复提醒和净额结算。
- Unified Trip Intelligence：统一 Operations、Readiness、Inbox、Live、Ledger、Document、Shared Trip 建议模型，不新增独立中心页面。
- 统一 action executor 已接入 Operations、Inbox、Live/Replan、票据与 Inbox 费用草稿；执行结果写入统一 `appliedChanges`。
- suggestion dispositions 与完成记录已迁移到 IndexedDB v10；普通非 Operations 建议可忽略或稍后 24 小时，高风险只能稍后，Operations 保留旅行时区当日 snooze。
- Finance 已停止后台来源扫描，只接收手动费用或 Ticket/Inbox 明确确认后的 `draft + needs_review`，再由 review queue 补充、确认和结算。
- Phase 12F 时间语义：PlainDate、WallClockTime、Instant、IANA 时区、`todayInTimeZone()`、DST 自动校正、跨日交通出发/到达时区解析已进入主路径并有单元测试。
- Limited Beta QA 基线：移动端 390x844 仍为完整 E2E 项目，新增桌面 1440x900 smoke 与真实构建 PWA v1 到 v2 升级测试。

## 已完成阶段

- Phase 11.6：Map-first collapsed sheet redesign。
- Phase 12-pre-A/B：恢复有用标签、简化 Trip 更多菜单。
- Phase 12-pre-C：full-page create/edit routes。
- Phase 12-pre-D：Trip Home / Day View 拆分计划。
- Phase 12-pre-E：拆分准备与共享数据加载。
- Phase 12-pre-F：导航回归检查。
- Phase 12A：自动云端同步基础。
- Phase 12B：启动云端同步检查。
- Phase 12C：冲突感知云端提示。
- Phase 12E：视觉完整性纠偏与全页表单布局修复。
- Phase 12F：时间语义收口完成，保持现有字段兼容，不做历史数据格式迁移。
- Phase 13A：Trip Home 地图概览与入口优化第一轮。
- Phase 13B：Day View marker 卡片交互第一轮。
- Phase 13C：全局 AI 咨询模式第一轮。
- Phase 14A：Item Detail 现场行动区第一轮。
- Phase 16A：Ticket Library 现场筛选第一轮。
- AI draft foundation / request builder / provider proxy operation / real provider adapter / privacy guard / repair guardrails。
- Search provider proxy foundation / AI trip edit patch plan foundation。
- E2E locator hardening。

## 不要误判为完成

- Trip Home 已收敛主建议层级，全旅行地图概览入口已完成第一轮；后续仍可继续做真实设备视觉 QA 和更丰富地图 provider 能力。
- Day View marker → 轻卡片 → Item Detail 现场路径已完成第一轮；后续仍可继续做真实设备视觉 QA 和更丰富现场信息布局。
- Item Detail 已完成现场行动区第一轮；后续仍可继续做真实设备视觉 QA、票据紧凑展示和更高级跨时区解释。
- Ticket Library 已完成票据画廊、元数据编辑器和现场筛选第一轮；后续仍可继续做全屏票据预览器和更细的票据分类。
- SwiftUI-like / iOS grouped list 设计系统尚未沉淀。
- 时间语义仍需在后续新功能中遵守 Phase 12F 边界：旅行日期用 Trip/Day 时区，提醒/同步/版本时间用 Instant，不新增半套时间字段；后续重点是 AI ISO datetime 显式确认、跨国家高级 UI 和实时 provider facts 的来源边界。
- Web search 虽已可通过 server-side Tavily env 接入，但仍只允许 AI Trip Edit 在明确搜索意图且用户确认后单次调用 `travel_search`；没有 source-bearing 结果就不声明实时信息。
- Google Places item lookup 是手动、单行程点、确认后写入的 foundation；不是自动 enrich、批量更新、路线生成或地点详情全量同步。
- AI thinking / reasoning 不做用户开关：当前由后端策略管理，默认保持 stable JSON mode，优先稳定结构化输出。
- 全局 AI 输入已区分只读咨询、confirmable local action 和 provider-backed patch plan；它仍不是多轮聊天助手，不自主浏览网页，不自动应用修改，不联动 route/ticket/cloud。

## 云端与同步状态

- Supabase 用于账号登录后的旅行对象同步和恢复。
- 本地数据库与路线缓存跟随账号 hash。旧全局 `TravelConsoleDB` 不自动删除，用户确认接管后复制业务数据和 blob，重建 sync outbox，不复制旧冲突、sync base、session 或设备状态。
- 当前版本同步 Trip / Day / Item / TicketMeta、主人账本、Replan、`trip_intelligence_applied_change` 与 `trip_intelligence_suggestion_state`；copy 票据文件使用独立 `cloud_ticket_blobs` 记录和 Storage 路径同步。
- 账本对象为 `ledger_settings`、`ledger_participant`、`ledger_budget`、`ledger_expense`，仍受主人账号 RLS 约束，不进入 Companion 共享投影。
- 旧 `cloud_trip_backups` / `snapshot.json` 路径保留为兼容与迁移路径；对象同步表不可用时会自动降级到旧 snapshot 同步。
- 自动云端同步默认开启，可由用户关闭；开启后在 Trip / Day / Item / Ticket / AI 应用 / 导入 / 内容补充 / 备注追加等写入成功后延迟同步对应对象。
- copy 票据 Blob 上传成功后，此设备离线缓存可被用户确认清理；清理不会删除 TicketMeta 或账号中的票据 Blob，可按需重新同步文件。
- 启动、恢复在线或登录变化时会比较此设备版本信号与账号数据 metadata，并补偿此设备更新、缺失云端同步记录或遗留同步中状态。
- 设置页有轻量同步队列摘要：待同步对象/票据数量、上次同步时间和少量票据上传状态；登录成功后按本机/账号数据方向提示正在同步到账号或此设备。
- 对象同步会先拉取账号对象，再推送此设备 outbox；不同对象和不同字段会自动合并，同一字段双边修改或删除/更新冲突要求用户确认。
- 旧版多条云端记录和旧版恢复出的离线缓存可能仍存在；当前版本不会自动迁移、合并、删除或清理这些历史数据。
- 删除本地旅行不会删除云端同步记录；删除云端记录必须走手动确认。
- 账号对象同步不是实时表同步或多人编辑；对象删除使用 tombstone 同步。Shared Trip 的同行实时通道独立于账号对象同步。
- intelligence applied changes 按 dedupeKey 去重展示；suggestion state 使用 latest `updatedAt` wins。清空历史、恢复建议与 retention prune 都同步 tombstone。
- Package 7 migration `20260620060942_persistent_trip_intelligence_sync.sql`、权限加固 migration `20260620074105_harden_production_boundaries.sql` 和 Companion owner `RETURNING` 前向修复 `20260620135038_allow_owner_select_companion_projection.sql` 均已部署生产。
- Shared Trip 成员资料、成员级票据摘要、真实票据原件授权/审计和空指定名单语义的 migration `20260705093000_companion_member_profiles_ticket_visibility.sql` 已部署生产；`20260705132000_fix_companion_ticket_grant_policy_recursion.sql` 已修复授权 grant policy 与票据 blob policy 的递归。本地 `db reset`、本地/linked lint、post-DDL SQL 检查、生产 Realtime smoke、生产 collaborator mutation smoke 和生产真实账号 JUAN/DONGJUN 可见性 smoke 均通过。
- 生产检查确认公开 Companion/Inbox RPC 为 invoker 薄入口，私有实现固定 `search_path`，15 个更新时间 trigger、RLS event trigger、reminder cron、9 条依赖 policy 和 8 个外键索引均保持有效；security advisor 只剩 Free 计划无法开启的泄露密码保护 warning，performance advisor 只新增 `cloud_ticket_blobs` owner/companion 双 SELECT policy warning。
- Companion 真实账号生产 smoke、JUAN/DONGJUN 按人票据可见性 smoke 与双设备 intelligence smoke 均完整通过并清理测试数据。双设备验证覆盖设备 A 忽略/完成与上传、设备 B 全新 IndexedDB 恢复、建议不重复、完成历史恢复、latest-wins 和 tombstone 删除传播。登录 refresh session 仅以 `0600` 权限缓存在仓库外，两个设备与 Companion 复用同一次登录。
- 长期协议升级路线已记录在 `docs/SUPABASE_CLOUD_BACKUP.md`；未来仍需 per-device 操作审计、队列调试工具和协议迁移工具。

## 数据与缓存边界

- IndexedDB 是此设备离线缓存与首写层。
- 旅行日期 / 时间语义见 `docs/TIMEZONE_AUDIT.md`：PlainDate 是 `YYYY-MM-DD`，WallClockTime 是地点当地钟表时间，Instant 用 epoch milliseconds，IANA 时区经校验后进入 Trip/Day/Item 和跨日交通解析，系统版本时间继续使用 absolute timestamp。
- 完整 zip schema v2 归档包含旅行、Day、Item、票据元数据、copy 文件内容和账本数据；继续接受无账本的 v1 归档。
- 汇率缓存只在本机使用，不进入 zip 或云同步；每笔费用保存自己的历史汇率快照，保证跨设备统计稳定。
- 路线缓存只保存在当前浏览器本机，不进入 zip、Supabase 或 trip-plan。
- Server-only OpenRouteService / Google Routes / Google Maps Platform shared server key / AI provider / Tavily / Google Places secrets 不进入前端 bundle、IndexedDB、zip、Supabase 或 trip-plan；浏览器可见的 Google Maps JS 渲染 key 只能作为公开受限 key 使用。若 Maps JS、Google Routes 和 Google Places 使用同一个实际 key 值，后端仍通过 `GOOGLE_MAPS_PLATFORM_API_KEY` 读取。
- Provider quota row id 只保存 bucket + hashed identity；不保存 raw IP/session。生产和可信预览使用 Supabase verified user id、Cloudflare request IP、D1 budgets 和 provider controls；D1 binding 存在但失败时 fail closed 为 normalized `quota_exceeded`，不调用 provider。
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
- Global AI command bar：普通咨询只读取当前本地 Trip/Day/Item/Ticket/Ledger 摘要，不调用 provider、不搜索、不写 IndexedDB；明确修改类指令才进入现有 AI Trip Edit 发送确认和 patch-plan preview。
- Side-effect boundary：repair 前后没有 route generation/cache、ticket creation、cloud upload/delete 或 sortOrder optimization。
- Security check：page/dist/report 不应包含 API key、key prefix、Bearer header、raw provider body、raw model output、full prompt 或 stack trace。
- DeepSeek reasoning：当前由后端策略管理。默认、simple 和 `auto` 路径发送 `thinking: { type: "disabled" }`；复杂任务可由后端选择 high reasoning。前端没有 Settings selector、AI Draft selector、search toggle 或 localStorage 模式开关。
- Web search：`travel_search` provider proxy 支持 mock/disabled/Tavily，真实 Tavily key 只在服务端 env 中使用，结果归一化为 title、URL、displayUrl、domain、snippet、retrievedAt、sourceType、confidence，并受独立 `search|` quota 约束。AI Trip Edit 可在用户确认后单次调用 search；AI draft generation / repair 不会调用 search。AI 不得在没有 sourced search results 时声称知道实时营业时间、票价、闭馆、交通中断、近期评价或活动。
- Google Places lookup：`place_lookup` provider proxy 支持 mock/disabled/google_places，优先使用 server-only `TRIPMAP_GOOGLE_PLACES_API_KEY`，缺省时回退到 server-only `GOOGLE_MAPS_PLATFORM_API_KEY`，并使用严格 FieldMask `places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri`。Item Detail 的“查找地点信息”只发送 visible item title/location/address 组成的 query，候选结果临时展示，确认后只更新当前 item 的 `locationName`、`address` 和有效 `lat/lng`；`googleMapsUri` 持久化、opening hours、ratings、reviews、photos、phone、website deferred。
- Route / key separation：前端路线生成只通过 `VITE_ROUTE_PROXY_URL` + `VITE_ROUTE_PROXY_PROVIDER` 调用 provider proxy；`VITE_OPENROUTESERVICE_API_KEY`、旧 ORS localStorage key、以及 `VITE_GOOGLE_MAPS_API_KEY` 都不会配置 OpenRouteService / Google Routes provider。Google Routes 优先使用 `GOOGLE_ROUTES_API_KEY`，缺省时回退到 server-only `GOOGLE_MAPS_PLATFORM_API_KEY`。Google Maps JS key 只作为浏览器可见、referrer-restricted 的地图渲染 key。Trip Home 路线顺序建议已恢复为 `route_order_suggestion` server proxy operation：点击“查看建议（仅建议）”后才请求，真实 v1 只用 server-side Google Routes waypoint optimization，应用前二次确认，确认后只更新当前日 `sortOrder`。

## 本地 QA 注意事项

- `wrangler pages dev` / Workerd 可能受 shell `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 影响。若 direct DeepSeek 检查健康但本地 provider proxy repair 间歇性 `network_error` / timeout，先用 unset proxy env 的 wrangler 进程重测。
- PWA service worker 可能在本地 QA 时提供旧 bundle。若页面行为和最新 build 不一致，先 unregister service worker、clear site data、hard refresh。
- PR4 后新增 `npm run test:e2e:desktop-smoke` 和 `npm run test:e2e:pwa-upgrade`；实体机 iPhone Safari / Android Chrome 结果必须人工写入 `docs/BETA_QA_RECORD.md`，不要提交截图。
- `wrangler pages dev` 的真实 provider env 必须通过 Pages Function `context.env` binding / secret 路径验证；不要假设 `.env.local` 或 `--env-file` 一定进入 `context.env`。Tavily 生产/预览用 Cloudflare Pages env/secrets 配 `TRIPMAP_SEARCH_PROVIDER=tavily` 和 `TRIPMAP_SEARCH_API_KEY`，本地真实 smoke 不要把真实 key 写进命令行参数。
- `.env.local` 和 `.dev.vars` 必须保持 gitignored，不得提交。报告不得包含真实 key、key prefix、raw provider body、full prompt 或 raw model output；如任何 key prefix 曾被复制进聊天或日志，应 rotate key。

## 下一步建议

优先执行 `docs/ROADMAP_V4.md` 中的后续阶段：

1. 完成 PR4 本地与远端 QA：build、lint、unit、桌面 smoke、PWA 升级、全量 E2E、GitHub Actions 和 Cloudflare production deploy。
2. 人工补录 iPhone Safari 与 Android Chrome 实体机检查。
3. AI ISO datetime 显式确认 / 映射设计，不允许静默截断成 plain date/time。
4. Item Detail 2.0 已完成第一轮；后续可扩展票据紧凑展示、跨时区解释和真实设备视觉 QA。
5. Trip Home / Day Map / 全局 AI 输入继续做真实设备视觉 QA 和 provider/mock 边界回归。

后续 Map Provider 或 Transit Hints 必须复用 Phase 12F 时间语义和 Provider 加固边界。AI 新能力继续走 provider proxy / quota / confirmation boundary；reasoning 和 search 由后端能力演进，不做用户可见模型控制。地图和交通新能力不得把无来源实时营业时间、ETA、航班延误或交通状态包装成本地 timezone 计算结果。
