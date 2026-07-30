# 旅图 TripMap 项目状态

更新时间：2026-07-29

## 发布判断

旅图当前代码处于 **Limited Beta Release Candidate**，同时已经切换到“实时在线、AI 优先”的下一阶段产品战略。核心旅行、票据、地图、账本、导入、账号同步、共享旅行、AI Action Gateway 和 Provider Proxy 已形成稳定迁移基线；cloud-first 写入、Realtime 订阅、统一实时事实和 AI job runtime 尚未完成，不能把目标能力写成当前事实。

发布仍以同一提交同时满足以下条件为准：

- GitHub Actions 的 `Lint`、`Type Check`、`Unit Tests`、`Build`、`E2E Tests` 全部通过。
- Cloudflare Pages 生产部署成功并指向同一提交。
- Supabase 迁移、RLS、授权和 advisors 已复核。
- iPhone Safari 与 Android Chrome 实体机结果补录到 [BETA_QA_RECORD.md](BETA_QA_RECORD.md)。

## 产品定位

旅图是面向出境旅行的 **实时在线、AI 优先旅行操作系统**。用户打开应用首先看到行程、当天安排、票据和实时变化，也可以直接用一句话让 AI 完成查询与操作，而不是阅读大段建议或寻找分散功能。

- **Target:** Supabase/Postgres 是账号事实源，Realtime 推送跨设备、协作和 AI job 变化。
- **Target:** AI Action Gateway 是默认操作层，自动完成只读查询，并对组合写入只要求一次风险匹配的确认。
- **Target:** 地点、路线、交通、天气、航班/铁路和票务事实统一携带来源、观测时间和有效期。
- **Current:** IndexedDB 仍是首写层，Supabase 负责对象同步、票据文件、恢复和 Shared Trip；后续改为云端提交优先，本机只作边缘缓存和失败 outbox。
- **Current:** PWA 缓存 app shell 和核心页面，地图、实时 Provider 和云端能力依赖网络。
- Provider key、权限、schema、幂等和高风险确认继续由系统强制，但不作为普通用户主界面的主要内容。

## UI 状态

- **Current:** 当前界面属于 UI V2 收敛版，已经具备设置折叠、真实图片缩略图、长文本防溢出、全局 AI 动作结果自动收起和 390px E2E 基线。
- **Current:** App Shell 仍同时包含全局顶栏、底部五项导航和常驻全局 AI 输入；Trip、Documents 等页面仍存在重复导航和首屏信息密度问题。
- **Current:** Home、Trip Workspace、Item Detail、Ticket Library、Travel Inbox、Settings 和 Global AI 的主要页面/组件仍较大，展示状态与业务状态耦合。
- **Target:** [UI V3 重构规范](UI_REFACTOR_V3.md) 已锁定工具链、设计权威、四项主导航、按需 AI Action Sheet、视觉 Tokens、响应式布局、无障碍和验收门槛。
- **Target:** UI V3 尚未实现，不能把四项导航、Toolbar AI、桌面主从布局或 V3 Golden Screenshots 描述为当前能力。

## 当前主路径

```text
#/home
#/trip?tripId=...
#/day?tripId=...&dayId=...&view=schedule|map
#/item?tripId=...&dayId=...&itemId=...
#/tickets
#/ledger?tripId=...
#/settings
#/ai-draft
```

已可用：

- Trip Home、Day View、Item Detail、日程/地图切换和外部地图跳转。
- 票据画廊优先展示；图片使用真实缩略图，PDF/其他文件使用对应预览；筛选、编辑、预览和绑定保持可用。
- 长票据名和长地点文本在 390px 移动端换行，不再造成横向溢出。
- 每日助手、实时行程、设置二级内容和新增票据表单默认收起，核心行程/画廊优先。
- 地点查询打开后自动发起当前地点搜索，候选确认后才写入当前行程点。
- 行程智能一键修复统一处理可自动修复的问题；高风险或需要用户判断的内容仍进入确认。
- 全局 AI Action Gateway 可执行票据打开、受限页面导航、地点补全、基础行程点新增、同日重排、跨日移动、可逆删除/撤销、进度更新、重排偏好、突发情况自适应重排、行程时间调整、路线预览、费用草稿和一键修复；只读动作直接完成，写入或路线请求只要求一次最终确认。
- AI Trip Edit 使用受限 patch plan、diff、stale-state 检查和最终确认，不直接写库。
- AI Draft generation/repair、导入预览、zip 归档和 HTML/XLSX/票据导入主路径。
- 地图、道路路线预览、本地路线缓存和失败直线回退。
- 旅行账本、预算、费用草稿、分摊和结算。
- Supabase 登录、账号隔离、对象同步、票据 Blob、Shared Trip、成员级票据授权与审计。
- 账号旅行离线编辑先保存在 IndexedDB 和对象 outbox；恢复在线后由现有 `online` 事件自动续传同一快照和对象变更，不追加重复快照。
- PWA 发现新版本后提示用户刷新，不在未确认时强制重载。

## AI 与实时能力

当前全局 AI 是“自然语言规划 + 版本化动作注册表”，不是可以任意调用内部函数的自主代理。

- 当前先做确定性识别，必要时调用 `ai_action_plan`；目标架构由 AI 统一规划，再由注册表、权限和状态版本决定是否执行。
- 本地校验拒绝未知动作、未知字段、依赖循环、超过 6 步的计划、歧义目标和敏感字段。
- 只读导航可自动执行；任何本地写入都先生成真实预览，再经过一次最终确认。
- 计划带旅行状态指纹和幂等键；旅行变化后拒绝旧计划，部分失败只重试失败步骤。
- 晚到、延误、闭馆、活动取消和不适宜天气只在用户明确报告后进入本地重排；确认时会再次核对旅行、重排偏好、票据 metadata 和账本影响，票据文件、订单和账本本身不会被改动。
- What-if、问句、否定表达和预订/付款取消措辞保持只读，不会创建突发事件或重排记录。
- 部分复杂账本和长文本行程编辑继续通过兼容路由工作，尚未全部迁入注册表。
- 实时营业时间、票价、闭馆、交通中断、评价和活动必须有来源；无来源就不作事实声明。
- AI 默认不发送票据文件、完整本地数据库、route cache、cloud token 或 provider secret。
- V1 不支持批量/整趟删除、取消预订、付款、发邮件、修改云端权限或调用任意函数。

下一阶段：

- 增加服务端 action catalog、异步 job、实时进度和跨设备幂等。
- 让只读 Place / Route / Search / Weather / Flight / Rail 查询按用户指令自动执行。
- 建立 `RealtimeFact`，统一 source、observedAt、expiresAt 和 confidence。
- 将低风险可逆写入合并为一次确认；付款、取消订单、发消息和权限修改继续单独确认。

## 工程基线

2026-07-28 本地基线：

- `npm run typecheck`：通过，覆盖前端、Pages provider runtime 和 Travel Inbox Worker。
- `npm run lint`：通过。
- `npm run test:unit`：187 个文件、1555 个测试通过。
- `npm run build`：通过；构建会强制执行 bundle budget。
- `npm run test:e2e:pwa-upgrade`：5 个测试通过；当前构建连续升级为 20/20，历史生产迁移为 5/5。
- 全量 Playwright：156 个测试通过，串行耗时约 7.3 分钟；覆盖离线账号续传和固定历史生产构建迁移。
- `git diff --check`：通过。

生产入口 JS 从 947.6 kB 降至 485.9 KiB。初始静态 JS 图为 868.3 KiB，gzip 249.6 KiB；全局 AI、Provider Proxy、MapLibre、PDF、OCR 和 JSZip 均不再进入静态启动图。CI 会阻止入口超过 500 KiB、初始 JS 超过 900 KiB、初始 gzip 超过 260 KiB，或上述低频模块重新进入启动图。

Service Worker 预缓存从约 4.15 MiB/107 项降至约 2.21 MiB/94 项。Trip、Day、Item、票据和资料核心代码继续预缓存；MapLibre、PDF/OCR、JSZip、AI Draft、全局 AI 和 31.7 KiB 的 Provider 网络执行实现改为首次使用后写入 30 天、最多 80 项的同源运行时缓存。Provider 的轻量配置、错误类型和本地合同仍随核心页面提供。构建会阻止核心代码丢失、Provider 网络执行实现或其他可选重资源回到预缓存、重复 URL 或预缓存超过 2500 KiB。真实构建测试同时确认连续三个当前 Service Worker 版本和两个固定历史生产产物都在用户确认前保持 waiting、确认后所有标签收敛、真实行程及离线 IndexedDB 修改保留；按需资源在下载中断或 origin 配额不足时不会留下残缺缓存，恢复后可重试并离线使用。

账号同步 E2E 同时确认网络离线时云端 fixture 不发生写入、对象 outbox 不提前消失；网络恢复后同一旅行快照原地更新，trip/item 对象各保持一条，自动快照状态收敛为 `synced`，刷新不会丢失离线修改。

CI 同时检查全部 TypeScript runtime，失败时保留 screenshot/video/trace，并取消同分支过时运行。官方 checkout、Node setup 和失败 artifact actions 已迁移到 Node 24 运行时。应用版本显示短提交 SHA，方便确认浏览器是否运行当前部署。

## 云端状态

- 当前账号对象仍通过 outbox 自动同步，尚未切换为 cloud-first ack 和统一 Realtime 订阅。
- Provider proxy 继续执行 Origin、Bearer、Supabase Auth、D1 quota、daily budget 和 kill switch。
- 生产 Supabase 已补齐 `account_ai_preferences`，4 条账号自有 RLS、私有更新时间 trigger 和 authenticated CRUD 授权均已验证。
- Companion invite 的冲突修复已存在于生产 `tripmap_private` 实现；仓库补回对应历史 migration，保证新环境重建一致。
- 已补齐 Companion 票据授权/事件表的 3 个外键索引。
- `travel_inbox_connector_secrets` 的 RLS 无 policy 为有意 fail-closed；它不对普通客户端开放。

当前 advisor 剩余项：

- Auth leaked-password protection 尚未启用，需要在 Supabase 计划/配置层处理。
- `cloud_ticket_blobs` 的 owner/companion 双 SELECT policy 有性能提示，修改前需在预览环境验证权限等价。
- 低使用率索引提示仅记录观察；新建外键索引尚无使用统计，不在缺少真实负载证据时删除。

## 已知发布风险

- 当前稳定版本不等于路线图 v5 目标版本：云端不是统一实时事实源，天气、航班、铁路、票务状态和实时交通 Provider 尚未形成完整主路径。
- AI 仍有兼容关键词路由和动作覆盖缺口，长任务没有统一 job runtime。
- iPhone Safari、Android Chrome 和安装到主屏幕后的实体机回归仍需人工完成。
- MapLibre 独立 chunk 仍超过 1 MB，首次成功下载仍需网络；自动化已覆盖下载中断重试，实体机弱网体验仍待记录。
- 浏览器旧 service worker 可能显示旧 UI；当前版本改为显式更新提示，仍需生产升级观察。
- 自动化已覆盖当前构建的 `v1 → v2 → v3`，以及 `4c8f60ec → 4c748935 → 当前候选` 的真实历史生产迁移；更早版本和实体机升级仍以 Beta 观察为准。
- 真实 provider 可用性还依赖 Cloudflare env、供应商配额、区域网络和当前登录 session；自动化主要覆盖合同、边界、mock 和失败语义。
- Action Gateway 当前覆盖十五个注册动作；复杂账本和长文本行程编辑仍有兼容路径，不能声称“任意一句话都能完成所有功能”。

## 文档入口

- 产品战略：[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md)
- 当前路线图：[ROADMAP_V5.md](ROADMAP_V5.md)
- UI V3 规范：[UI_REFACTOR_V3.md](UI_REFACTOR_V3.md)
- Design System：[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)
- 历史路线图：[ROADMAP_V4.md](ROADMAP_V4.md)
- Beta 验收：[LIMITED_BETA_READINESS.md](LIMITED_BETA_READINESS.md)
- QA 记录：[BETA_QA_RECORD.md](BETA_QA_RECORD.md)
- Provider 合同：[PROVIDER_PROXY.md](PROVIDER_PROXY.md)
- Supabase 实时云端平台：[SUPABASE_CLOUD_BACKUP.md](SUPABASE_CLOUD_BACKUP.md)
- 时间语义：[TIMEZONE_AUDIT.md](TIMEZONE_AUDIT.md)
