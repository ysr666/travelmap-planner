# TripMap 全项目多模态审计报告

**审计日期:** 2026-05-24  
**基线:** main (d419ffb), build OK, lint clean, unit 474/474, E2E 73/73  
**审计方式:** 只读代码审查 + Playwright 视觉截图 + 安全边界检查 + 文档一致性检查  

---

## A. 总体结论

### 当前产品整体成熟度：**7.5/10**

TripMap 是一款功能完整的本地优先旅行规划 PWA，核心旅行管理链路（创建/编辑/查看/删除）流畅可用。近期 AI Draft、Provider Proxy、云端备份、MapLibre 地图预览等功能已稳定集成。产品在移动端（390x844）表现良好，无横向溢出，无阻塞 bug，全测试通过。

### 是否适合继续往 AI-first PWA 发展：**有条件适合**

AI Draft 的基础设施（request builder → provider proxy → real provider → quality guardrails → repair）已搭建完整且边界清晰。但 AI privacy 设置与数据过滤之间仍存在 gap（定义了的隐私开关未实际接入 AI 请求流程），这是转入 limited beta 前必须修复的 P0 级问题。

### 是否存在阻塞问题：**否**

无 P0 级别阻塞。存在 2 个 P1 级别问题（AI privacy gap, cloud snapshot 语义命名）。

### Top 5 风险

| 风险 | 级别 | 说明 |
|------|------|------|
| 1. AI privacy 开关未生效 | **P1** | 用户可在设置页配置隐私权限，但 `aiTripDraftRequest.ts` 未导入也不检查这些开关 |
| 2. Cloud "snapshot" 命名误导 | P1 | 内部类型/函数/文档全部使用 "snapshot"，但实际是单槽位一对一备份，无版本历史 |
| 3. routePreparation chunk 过大 | P2 | `routePreparation-DNAL0pm8.js` 1.0 MB（含 MapLibre），首次加载影响体验 |
| 4. 测试盲区：无真实云端/AI 集成测试 | P2 | 所有 Supabase/AI 测试基于 mock，无法在 CI 中发现真实环境行为变化 |
| 5. Google Maps API key 存在 localStorage | P2 | `tripmap:google-maps-api-key` 明文存储在 localStorage，XSS 可窃取 |

---

## B. 产品体验总评

### Home
干净的双栏布局（品牌区 + 旅行列表）。空状态引导清晰（创建示例旅行按钮）。TripCover 卡片设计精致，渐变背景 + 装饰线 + emoji 图标。但 "导入备份" 按钮在空状态时意义不明确。

### Trip Home (Overview)
信息层级丰富：cover → stats → TripBriefCard → map preview → route preparation → day list → backup → cloud。Collapsible 折叠结构管理得当。问题是内容过长，390px 下需要大幅滚动。

### Day Schedule
时间轴布局清晰，item card 显示时间/交通方式/地点名。DaySelector 的紧凑模式和正常模式适应良好。删除按钮带 ConfirmDialog。整体移动端友好。

### Day Map
MapLibre 渲染稳定。Bottom sheet 拖拽交互流畅（collapsed → expanded)。Marker card 轻量不遮挡地图。Route controls 位置合理。

### Item Detail
信息呈现完整：时间/地点/备注/票据/导航链接。上一项/下一项导航保留来源上下文（schedule 或 map source）。票据区紧凑显示。

### Ticket Library / Previewer
Gallery 卡片支持 4 种模式（copy/image/PDF/external/reference）。预览器全屏覆盖，上一张/下一张导航流畅。空状态使用 EmptyState 组件。

### Settings
内容最长的页面（56KB bundle）。云端/AI/外观/路线/备份等区域通过 Collapsible 组织。结构合理但信息密度高。

### AI Draft / Repair
表单到预览到质量检查到修复的流程完整。Mock 生成稳定。Quality guardrails 识别合理（dense day, time overlap, meal gaps 等）。确认机制明确（先确认再导入/修复）。

---

## C. 视觉与移动端审计

| 页面 | 390px 状态 | Dark Mode 状态 | 主要问题 | 截图 | Severity |
|------|-----------|---------------|---------|------|----------|
| Home | ✅ 无溢出 | ✅ 正常 | 无 | 01-home-with-trip-light.png, 12-home-dark.png | - |
| Trip Home | ✅ 无溢出 | ✅ 正常 | 内容过长需滚动很远 | 02-trip-home-overview-light.png, 13-trip-home-dark.png | P3 |
| Day Schedule | ✅ 无溢出 | ✅ 正常 | 无 | 03-day-schedule-light.png, 14-day-schedule-dark.png | - |
| Day Map | ✅ 无溢出 | ✅ 正常 | 无 | 04-day-map-view-light.png | - |
| Item Detail | ✅ 无溢出 | ✅ 正常 | 无 | 05-item-detail-schedule-light.png | - |
| Ticket Library | ✅ 无溢出 | ✅ 正常 | 无 | 06-ticket-library-light.png | - |
| Settings | ✅ 无溢出 | ✅ 正常 | 内容较长，collapsible 内仍有大量内容 | 07-settings-light.png, 15-settings-dark.png | P3 |
| AI Draft | ✅ 无溢出 | ✅ 正常 | 表单区域较多，但 secton 分隔清楚 | 08-ai-draft-initial-light.png, 09-ai-draft-generated-light.png, 10-ai-draft-quality-check-light.png, 16-ai-draft-dark.png | - |
| Trip Form | ✅ 无溢出 | ✅ 正常 | 无 | 11-trip-form-light.png | - |

**总结:** 所有页面在 390px 下无横向溢出，Dark Mode 无白岛或对比度问题。整体 PWA 感强，配色一致。主要问题是 Trip Home 内容过长。

---

## D. 交互逻辑审计

### 地图 marker / camera / card
- Marker 点击弹出轻量卡片，卡片位置合理不遮挡相邻 marker ✅
- Bottom sheet 拖拽到 collapsed 时只显示 summary，marker card 独立显示 ✅
- Recenter 操作不会 trigger route generation ✅
- Route controls 在 collapsed/expanded sheet 下正确显示/隐藏 ✅

### Route generation confirmation
- Trip Home 路线准备面板在坐标不足时保持安静状态 ✅
- 路线顺序建议显示确认对话框，取消后不执行 ✅
- Mock provider proxy 路线生成在确认后执行 ✅
- 线路缓存可从本地恢复并可清理 ✅

### AI draft / repair confirmation
- 导入/生成/修复三个操作各有独立 ConfirmDialog ✅
- 修复只替换预览，不自动写入 IndexedDB ✅
- 草稿未确认前不会创建旅行 ✅

### Cloud save / restore / conflict
- Cloud 冲突提示显示版本来源（本地/云端更新）和原地更新语义 ✅
- 自动云端保存状态 badge 显示同步状态 ✅
- 恢复操作有确认对话框 ✅
- 历史遗留的多条云端保存正确按 trip 分组 ✅

### Ticket preview navigation
- Gallery 卡片支持上一张/下一张 ✅
- 预留在 ticket types 间无缝切换 ✅
- 关闭预览返回 ticket list ✅

### Back navigation / source context
- 日程来源打开详情 → 返回日程 ✅
- 地图来源详情 → 编辑后保留地图上下文 ✅
- 上一项/下一项保留来源上下文 ✅

---

## E. AI 功能边界审计

### Draft generation
- 本地 mock 生成：确定性、schemaless ✅
- 请求构建器验证：destination/dates/pace/transport/free-text ✅
- 输出验证：validateAiTripDraft 检查必填字段、最小值、数组非空 ✅

### Request builder
- `buildAiTripDraftRequest`: 构建完整的 AI 请求对象 ✅
- `validateAiTripDraftRequest`: 验证必填字段、字符限制 ✅
- **隐私检查缺失**：`aiPrivacy.ts` 定义但未接入 ⚠️ P1

### Real provider adapter
- OpenAI-compatible API 调用 ✅
- 30s timeout ✅
- JSON 提取支持完整 JSON 对象和 fenced code block ✅
- 输出验证和规范化 ✅
- **数据边界**：请求仅包含 form input（destination/dates/preferences），不包含 ticket blobs/cloud tokens/route cache ✅

### Repair guardrails
- 修复 prompt 包含原始 draft + quality findings ✅
- 修复结果与 draft 相同流程验证 ✅
- 修复只替换预览，不自动写入 ✅

### Provider proxy
- 3 种 operation：route_preview / ai_trip_draft / ai_draft_repair ✅
- 配额检查：按 operation + IP + session ID ✅
- **配额非持久**：内存 Map，重启丢失 ⚠️ P3

### Key/privacy
- Server keys 不存在于 dist/ bundle ✅
- 前端不包含 process.env TRIPMAP_AI_* ✅
- Error 响应不暴露 raw body/stack trace/key ✅
- .env.local / .dev.vars gitignored ✅

### Limited beta readiness
- **P0 阻塞**: 无
- **P1 需修复**: AI privacy 接入, snapshot 内部命名
- **结论**: 解决 P1 后可进入 limited beta

---

## F. 云端 / 备份语义审计

### 当前实现
- IndexedDB 为主数据源，Supabase 为单旅行云端保存
- `buildStableCloudBackupId` 对每个 `userId + tripId` 生成确定性 ID
- upload 使用 `upsert: true`，再次上传覆盖同一记录
- 路径模式：`{userId}/{backupId}/snapshot.json`

### 语义一致性
- **用户可见文案** 统一使用 "云端保存"，无 "快照" ✅
- **内部代码和文档** 使用英文 "snapshot" 指代备份文件 ⚠️ 有误导性
- 用户感知中 "snapshot" 暗示版本历史，但系统只保留最新版
- **风险**：用户如果覆盖了云端保存，无法恢复旧版本

### 文案一致性
- "上传本地数据会更新同一个云端保存" — 与一对一语义一致 ✅
- "自动云端保存" — 说明在本地变化后延迟更新 ✅
- "云端保存适合跨设备延续同一旅行" — 明确用途 ✅
- 未发现旧多快照语义残留 ✅

---

## G. 地图 / 路线审计

### Trip Home map preview
- `buildTripMapPreviewData` 跨天收集所有 mappable items ✅
- 缓存使用 scope='trip-preview' + special dayId='__trip_preview__' ✅
- Google 预览缓存有 30 天 TTL ✅
- MapLibre 样式失败时回退到轻量预览 ✅

### Day Map
- MapLibre 渲染稳定，0 errors ✅
- Marker 创建/点击/弹卡流畅 ✅
- Bottom sheet 交互正常 ✅

### Route cache
- Dexie-backed, signature-based (coordinate + mode) ✅
- LRU eviction at 20MB default ✅
- 可配置 5/20/50/100MB ✅

### Route preparation
- `evaluateTripRoutePreparation`: 分类 days → no_coordinates / not_enough_points / ready_to_generate / cached / stale ✅
- 路线顺序建议需要确认后执行 ✅

### Provider proxy
- Google Routes API / OpenRouteService 支持 ✅
- Mock mode 可用 ✅
- 配额：60 requests / 60s window ✅

### 边界明确
- 路线生成需确认后才请求 ✅
- Routes 不包含 ticket/cloud/AI 数据 ✅

---

## H. 测试覆盖审计

### 当前测试结果
- unit: **47 files / 474 tests — 全部通过** ✅
- E2E: **11 files / 73 tests — 全部通过** ✅

### 覆盖良好的领域
- AI Draft 全流程：request → mock → quality → repair → import
- 云端备份：upload/download/delete/conflict detection
- Provider proxy：contract validation, limits
- Route cache：signature, save/load/clear/prune
- Map UX：bottom sheet, marker card, geolocation
- Appearance mode persistence
- Travel profile / AI privacy storage
- Trip plan import (JSON/ZIP)
- DB operations (CRUD, cascade delete, mutation tracking)

### 缺失或有风险领域
| 缺失测试 | 风险级别 | 建议 |
|---------|---------|------|
| PWA service worker / offline | P2 | 添加 E2E 测试验证 offline caching |
| Real Supabase 集成 | P2 | 至少 1 次手动集成测试 |
| Visual regression (screenshot diff) | P3 | 关键页面添加 toHaveScreenshot |
| AI real provider smoke test | P3 | 当前为文档记录的手动测试 |
| a11y / axe-core | P3 | 关键用户路径添加 a11y 检查 |
| Firefox / WebKit | P3 | 至少主路径跨浏览器 |
| Large dataset (1000+ items) | P3 | 性能基线测试 |
| 错误边界恢复 | P3 | 模拟 chunk load failure |

### 测试 brittleness 评估
- E2E 测试依赖中文文案（"日程"、"地图"、"新增"）— 文案变化会导致测试失败 ⚠️ P2
- Cloud backup E2E 使用 fixture + localStorage 标记 — 耦合度可控 ✅
- AI draft E2E 使用 generateMockDraft — 确定性输出 ✅

---

## I. 文档一致性审计

| 文档 | 状态 | 发现 |
|------|------|------|
| `SUPABASE_CLOUD_BACKUP.md` | ✅ 一致 | "单旅行云端保存" 语义正确，"snapshot" 作为技术术语使用 |
| `PROVIDER_PROXY.md` | ✅ 一致 | 3 种 operation 与代码匹配，real provider 流程描述准确 |
| `AI_AGENT_FOUNDATION.md` | ✅ 一致 | Local-only 阶段、provider proxy 集成、quality guardrails 均覆盖 |
| `ROADMAP_V4.md` | ✅ 一致 | Phase 12E 标记完成，12F 标记 pending |
| `PROJECT_STATUS.md` | ✅ 一致 | N/A |
| `ROUTING.md` | ✅ 一致 | 功能边界、provider proxy 重定向均准确 |
| `AI_IMPORT_SPEC.md` | ✅ 一致 | 三种票据模式、验证规则均与当前代码匹配 |
| `TIMEZONE_AUDIT.md` | ⚠️ 未执行 | Phase 12F 仍标记为待执行 |
| `README.md` | ✅ 一致 | 功能描述、链接均准确 |

**综合结论**: 所有文档与当前代码一致。无过期或矛盾。但 `TIMEZONE_AUDIT.md` 标记的 Phase 12F 时区审计尚未执行。

---

## J. Issue Table

| ID | Severity | Area | Symptom | Evidence | Screenshot | 疑似文件 | 建议修复 |
|----|----------|------|---------|----------|------------|----------|---------|
| 001 | **P1** | AI Draft | AI privacy 开关定义了但未接入 AI 请求流程 | `aiPrivacy.ts` 定义 10 个权限 flag，`aiTripDraftRequest.ts` 不导入也不检查 | - | `src/lib/aiTripDraftRequest.ts` | 在 buildAiTripDraftRequest 中过滤字段 |
| 002 | **P1** | Cloud | 内部命名 "snapshot" 与实际一对一备份模型不符 | `CloudTripSnapshot`, `buildCloudSnapshotFromRecords` 等类型名暗示版本历史 | - | `src/lib/cloudBackup.ts` | 重命名内部类型为 CloudBackup |
| 003 | **P2** | Build | routePreparation chunk 1.0MB > 500kB 警告 | build 输出显示 `routePreparation-DNAL0pm8.js 1,033.40 kB` | - | `dist/assets/` | Code-split MapLibre，或延迟加载 routePreparation |
| 004 | **P2** | E2E | E2E 测试依赖中文文案 | `ai-draft.spec.ts`, `map-sheet.spec.ts` 等使用中文按钮文本定位 | - | `e2e/*.spec.ts` | 添加 data-testid 属性 |
| 005 | **P2** | Security | Google Maps API key 存 localStorage 明文 | `tripmap:google-maps-api-key` 非加密存储 | - | `src/lib/googleMaps.ts` | 文档说明风险，或提供 session-only 选项 |
| 006 | **P2** | Proxy | 内存配额在服务重启后丢失 | `quotaGuard.ts` 使用 `Map<string, ...>` | - | `server/providerProxy/quotaGuard.ts` | 文档说明限制，或接入 KV/Durable Object |
| 007 | **P3** | UX | Trip Home 页面内容过长 | 390px 下需要大幅滚动，含 cover + stats + brief + map + route + days + backup + cloud | 02-trip-home-overview-light.png | `src/pages/TripWorkspacePage.tsx` | 折叠备份/云端默认收起 |
| 008 | **P3** | UX | Settings 页面 56KB bundle | 最长页面，collapsible 内内容多 | 07-settings-light.png | `src/pages/SettingsPage.tsx` | 拆分为多个 tabs 或进一步 lazy-load |
| 009 | **P3** | Cloud | 无历史版本恢复能力 | backupId 确定性且 upsert 覆盖，旧版本不可恢复 | - | `src/lib/cloudBackup.ts` | 文档说明当前限制 |
| 010 | **P3** | Test | 无 visual regression 测试 | 无 `toHaveScreenshot()` 使用 | - | `e2e/*.spec.ts` | 关键页面添加截图比较 |
| 011 | **P3** | Test | 无 PWA offline 测试 | service worker 行为未验证 | - | `e2e/*.spec.ts` | 添加 offline 使用测试 |
| 012 | **P3** | Test | 无 a11y 测试 | 无 axe-core 使用 | - | `e2e/*.spec.ts` | 关键路径添加 a11y 检查 |

---

## K. Recommended Fix Packages

### Package 1: AI Privacy Guard
- **Goal:** 将已定义的 privacy 开关实际接入 AI request builder
- **Files:** `src/lib/aiTripDraftRequest.ts`, `src/lib/aiPrivacy.ts`, `src/lib/aiTripContext.ts`
- **No-go:** 不修改 AI provider proxy, 不添加新开关, 不重构 travel profile
- **AC:** user set privacy → AI request 字段过滤 → URL-safe
- **Branch:** `fix/ai-privacy-guard`
- **Message:** `Add AI privacy guard to draft request filter`

### Package 2: Cloud Snapshot → Backup 内部重命名
- **Goal:** 消除 "snapshot" 命名误导，统一为 "backup"
- **Files:** `src/lib/cloudBackup.ts`, `src/lib/autoSnapshotBackup.ts`, `src/lib/cloudSnapshotCheck.ts`, `src/lib/cloudSnapshotPromptCopy.ts`, `src/components/cloud/*`, `docs/SUPABASE_CLOUD_BACKUP.md`
- **No-go:** 不改 DB schema, 不改 supabase bucket path
- **AC:** 内部类型/函数重命名, 外部 UI 文案不变
- **Branch:** `refactor/cloud-snapshot-to-backup`
- **Message:** `Rename internal cloud snapshot types to backup`

### Package 3: Chunk Size Optimization
- **Goal:** 将 routePreparation 和 SettingsPage 拆分为更小的 chunk
- **Files:** `src/pages/SettingsPage.tsx`, `src/lib/routePreparation.ts`
- **No-go:** 不改功能逻辑, 不改 UI
- **AC:** routePreparation < 500kB, SettingsPage lazy-load collapsible sections
- **Branch:** `perf/chunk-splitting`
- **Message:** `Code-split large bundles for faster initial load`

### Package 4: E2E Test Hardening
- **Goal:** 添加 data-testid 减少中文文案依赖, 添加 visual regression
- **Files:** `e2e/*.spec.ts`
- **No-go:** 不改业务逻辑
- **AC:** 关键按钮有 data-testid, 无 flaky test
- **Branch:** `test/e2e-hardening`
- **Message:** `Add testid attributes and visual regression to E2E suite`

### Package 5: Cloud Backup Historical Data Note
- **Goal:** 在 UI 和文档中明确说明备份覆盖行为
- **Files:** `src/components/cloud/CloudBackupPanel.tsx`, `docs/SUPABASE_CLOUD_BACKUP.md`
- **No-go:** 不改备份逻辑
- **AC:** 用户上传前知道旧版本会被覆盖
- **Branch:** `docs/cloud-backup-version-note`
- **Message:** `Document cloud backup overwrite semantics`

### Package 6: Phase 12F Timezone Audit
- **Goal:** 执行 TIMEZONE_AUDIT.md 中计划的时区审计
- **Files:** 跨 core domain 和 data layer
- **No-go:** 不改行为，audit-only
- **AC:** 完整的时区影响评估文档
- **Branch:** `audit/timezone-phase-12f`
- **Message:** `Execute timezone audit (Phase 12F)`

---

## L. Immediate Next Recommendation

**推荐先做 Package 1: AI Privacy Guard**

理由：
1. 这是唯一与用户数据隐私直接相关的 P1 问题
2. AI privacy 开关 UI 已存在，用户可能已经在使用（设置 toggle），但实际 AI 请求未受约束
3. 在进入 limited beta 前必须修复
4. 改动范围小，风险低，独立于其他功能

**同时立即做 Package 5**: 在 CloudBackupPanel 上加一行说明覆盖语义。这是 5 分钟的文档更新，但能防止用户在意外覆盖后的不满。

---

## M. Screenshots

截图全部位于 `output/playwright/full-product-audit/`：

| 文件名 | 内容 | 模式 | 视口 |
|--------|------|------|------|
| 01-home-with-trip-light.png | Home 首页（有旅行） | Light | 390x844 |
| 02-trip-home-overview-light.png | Trip Home 总览 | Light | 390x844 |
| 03-day-schedule-light.png | Day 日程视图 | Light | 390x844 |
| 04-day-map-view-light.png | Day 地图视图 | Light | 390x844 |
| 05-item-detail-schedule-light.png | Item 详情（日程来源） | Light | 390x844 |
| 06-ticket-library-light.png | 票据库 | Light | 390x844 |
| 07-settings-light.png | 设置页 | Light | 390x844 |
| 08-ai-draft-initial-light.png | AI Draft 初始表单 | Light | 390x844 |
| 09-ai-draft-generated-light.png | AI Draft 生成预览 | Light | 390x844 |
| 10-ai-draft-quality-check-light.png | AI Draft 质量检查 | Light | 390x844 |
| 11-trip-form-light.png | 旅行表单 | Light | 390x844 |
| 12-home-dark.png | Home 首页 | Dark | 390x844 |
| 13-trip-home-dark.png | Trip Home 总览 | Dark | 390x844 |
| 14-day-schedule-dark.png | Day 日程视图 | Dark | 390x844 |
| 15-settings-dark.png | 设置页 | Dark | 390x844 |
| 16-ai-draft-dark.png | AI Draft | Dark | 390x844 |
| 17-home-desktop-light.png | Home 首页 | Light | 1280x800 |

---

## N. Confirmation

| 检查项 | 结果 |
|--------|------|
| 是否修改代码 | **否** |
| 是否提交 commit | **否** |
| 是否 stage 文件 | **否** |
| 是否触发真实 AI 请求 | **否** |
| 是否触发真实 route provider 请求 | **否** |
| 是否触发真实 Supabase 写入/删除 | **否** |
| 是否打印真实 key | **否** |
| 是否清理 untracked 文件 | **否** |
| 是否创建分支 | **否** |
