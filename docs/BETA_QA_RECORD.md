# Limited Beta QA 记录

> **历史记录：** 本文是各版本验证凭据，只描述测试发生时的实现。当前产品战略与未来规划见 [产品战略](PRODUCT_STRATEGY.md)、[Roadmap V5](ROADMAP_V5.md) 和 [UI V3](UI_REFACTOR_V3.md)。

最新记录：2026-08-05

## 2026-08-05 UI V3 候选浏览器验收

- 候选分支实现四项主导航、阶段化 Today、按需 AI Action Sheet、连续时间轴、单一地点 Sheet、资料编辑式预览列表、渐进表单和四组设置。
- Selected Target 的出发前、旅行中、行程和资料四个核心状态均完成 `390 x 844` 同状态并排审查；没有待修复的 P0、P1 或 P2 视觉问题。
- Golden/视觉流程覆盖 `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900`，并覆盖长文本、200% 文本、软件键盘、浅色/深色和无横向溢出。
- `npm run typecheck`、`npm run lint`、`npm run test:unit` 和 `npm run build` 通过；单测为 191 个文件、1577 个测试。
- `npm run test:e2e:pwa-upgrade` 5/5 通过；历史生产包专用空状态断言保留历史文案，未用 V3 文案改写旧产物事实。
- `npm run test:e2e:serial` 最终重跑 173/173 通过，串行耗时约 6.3 分钟。
- 当前设备探测只有一台离线 iPhone，Android 未连接。不得用桌面移动视口或模拟器代替实体机发布结论。
- 远端 CI 和 Cloudflare 结果必须在候选提交推送后按同一 SHA 补录；本记录当前只证明本地候选。

### 模拟器补充记录

- iPhone 16 / iOS 26.5 Simulator Safari 已验证无旅行、旅行后 Today、行程时间轴、地图、资料、我的和 AI Action Sheet；输入获得焦点后，Sheet 保持在软件键盘可见区域内。
- Android API 33 Emulator 使用临时本地 WebView 壳加载同一 PWA，验证 Today、行程、地图 Canvas、资料、我的和 AI Action Sheet；核心页面均满足 `scrollWidth === clientWidth`。
- Android WebView 103 不支持 `dvh/svh`，暴露 App Shell 半屏高度问题。增加 `100vh` 回退后，`innerHeight`、`#root`、`.app-viewport` 和底部导航底边均收敛到约 `867px`；软件键盘打开后同步收敛到约 `554px`。
- 上述模拟器结果不覆盖 Chrome/PWA 安装、冷启动、真实设备性能、真实文件选择、弱网或升级，实体机表仍保持待人工补录。

完整视觉与发布边界见仓库根目录 `design-qa.md`。

## 2026-07-28 历史生产 PWA 迁移矩阵

- 固定使用曾成功部署到 Cloudflare Pages 的两个 `main` 提交：`4c8f60ec`（Limited Beta 收尾）和 `4c748935`（PWA 预缓存预算）。
- 测试从各提交的精确 Git tree 和 package lock 生成真实 Vite/PWA 产物；提交、tree 和 lock object 任一不匹配都会失败，历史依赖按 lock 哈希隔离缓存。
- 两个历史产物和当前候选在同一浏览器 origin 依次替换；每次新 Service Worker 都在用户确认前保持 waiting，两个标签继续使用旧 worker，确认后再共同收敛。
- 第一版中创建的真实示例旅行经过两次跨产物升级仍保留；中间版本离线修改的旅行标题在当前候选中可见并能正常打开。
- 最终激活后只保留一个当前 precache，旧历史 precache 已清理。
- CI 的 E2E checkout 使用完整 Git 历史以解析固定提交，不下载可变部署产物，也不调用真实 Cloudflare、Provider、Supabase 或账号数据。
- 聚焦历史迁移用例连续 5 轮通过；完整 PWA 文件 5/5 通过。
- `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run build` 均通过；全量串行 E2E 156/156 通过，约 7.3 分钟。

## 2026-07-28 离线账号同步恢复

- 账号旅行在线打开后切换为真实浏览器离线状态；离线编辑旅行标题和行程点时，IndexedDB 立即保留修改，账号快照与对象记录保持不变。
- 离线期间两个对象 outbox 项保持待处理；恢复在线只依赖现有浏览器 `online` 事件，自动完成一对一快照覆盖和 trip/item 对象同步。
- 恢复后同一旅行只有一个账号快照、trip/item 各一个对象记录、outbox 清空且自动快照状态为 `synced`；刷新后本地修改继续保留。
- 全部云端行为使用现有 Supabase E2E fixture，未调用真实 Supabase 或 Provider。
- 聚焦恢复用例连续 10 轮通过，`cloud-backup.spec.ts` 13/13 通过。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；`npm run test:unit` 187 个文件、1555 个测试通过。
- 首次全量串行 E2E 仅出现一次无关 AI 页面 `beforeEach` 导航超时；该用例隔离及连续 10 次均通过，完整重跑 155/155 通过，约 5.9 分钟。

## 2026-07-28 PWA 连续升级与存储压力

- built-dist PWA 新增 `v1 → v2 → v3` 连续升级矩阵；两次更新都在用户确认前保持 waiting，确认后两个标签切换到同一版本。
- 在 v2 离线写入的 IndexedDB 标记经过 v3 激活和双标签重载后仍完整保留。
- 使用 Chromium `Storage.overrideQuotaForOrigin` 将可用空间压到低于 MapLibre chunk；网络响应仍保持完整，运行时缓存不保留残缺项。
- 恢复 quota 后，同一资源可完整写入 `tripmap-on-demand-assets-v1`，随后离线返回相同字节长度。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；bundle budget 为 868.3 KiB 初始 JS、249.6 KiB gzip、2301.0 KiB/94 项预缓存。
- `npm run test:unit`：通过，187 个文件、1555 个测试。
- `npm run test:e2e:pwa-upgrade`：4 个测试通过；连续 5 轮稳定性验证共 20/20 通过。
- `npm run test:e2e:serial`：154 个测试通过，约 6.1 分钟。
- 本轮覆盖当前构建内的连续 Service Worker 修订；真实历史生产产物由上方独立矩阵覆盖，iPhone/Android 实体机记录仍需人工补录。

## 2026-07-26 Provider 网络执行按需边界

- Provider 客户端保留 2.1 KiB facade 和 1.7 KiB 配置/错误共享层；31.7 KiB 网络执行实现只在真实操作时动态加载。
- Service Worker 预缓存约 2.21 MiB/94 项；Provider 网络执行实现不在预缓存，核心 Trip、Day、Item 和票据路径首次离线仍可打开。
- 构建检查同时要求 Provider 网络实现保持独立动态 chunk，并按实际 manifest 文件确认其不在预缓存。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过。
- `npm run test:unit`：通过，185 个文件、1472 个测试。
- `npm run test:e2e:pwa-upgrade`：通过，2 个测试。
- `npm run test:e2e`：通过，141 个测试，约 4.1 分钟。
- 地点候选、路线生成、内容来源、AI Draft、全局 AI Action Gateway、Auth 错误语义、预览和最终确认 E2E 均继续通过。

## 2026-07-26 PWA 预缓存与按需资源

- Service Worker 预缓存从约 4.15 MiB/107 项降至约 2.28 MiB/92 项；后续 Provider 网络执行拆分进一步降至约 2.21 MiB/94 项。
- MapLibre、PDF/OCR、JSZip、AI Draft 和全局 AI 不再随安装下载，首次使用后进入同源 `CacheFirst` 运行时缓存。
- Trip、Day、Item、Ticket Library 和 Travel Document Center 保持预缓存；加密资料库备份的 JSZip 改为真正按需加载。
- 构建检查新增预缓存唯一性、核心必需项、可选禁入项、运行时缓存名和 2500 KiB 上限。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过。
- `npm run test:unit`：通过，185 个文件、1472 个测试。
- `npm run test:e2e:pwa-upgrade`：通过，2 个测试。
- `npm run test:e2e`：通过，141 个测试，约 4.0 分钟。
- built-dist 浏览器验证：核心旅行/日程/地点/票据页面在首次离线时可打开；MapLibre 首次在线使用后可在离线状态命中运行时缓存；PWA v1 到 v2 升级继续保留 IndexedDB。

## 2026-07-25 AI Action Gateway 与首屏分包

- `main` 合并提交 `5477ce6`：GitHub Actions 的 Type Check、Build、Lint、Unit Tests、E2E Tests 全部通过；Cloudflare Pages 同 SHA 部署通过。
- `npm run typecheck`：通过；覆盖前端、Pages provider runtime 和 Travel Inbox Worker。
- `npm run lint`：通过。
- `npm run test:unit`：通过，184 个文件、1471 个测试。
- `npm run build`：通过；bundle budget 同步通过。
- Bundle：入口 JS 947.6 kB 降至 476.9 kB；初始静态 JS 848.2 KiB，gzip 244.8 KiB。
- 初始静态依赖检查：全局 AI、Provider Proxy、MapLibre、PDF、OCR 和 JSZip 均未进入启动图。
- `npm run test:e2e:pwa-upgrade`：通过，1 个测试。
- `npm run test:e2e`：通过，140 个测试，约 7.8 分钟。
- 移动端可访问性测试已适配动态资源在整页导航时的正常 `ERR_ABORTED`；404、HTTP 错误、控制台错误和非导航资源失败仍会失败。

Action Gateway V1 覆盖票据打开、地点补全和行程修复；E2E 验证只读直达、一次写入确认、stale guard、部分失败继续和只重试失败步骤。实体机结果仍不得由自动化假填。

## 2026-07-24 Release Candidate 收尾

- `npm run typecheck`：通过；覆盖前端、Pages provider runtime 和 Travel Inbox Worker。
- `npm run lint`：通过。
- `npm run test:unit`：通过，180 个文件、1447 个测试。
- `npm run build`：通过；保留既有大 chunk 警告。
- `npm run test:e2e:pwa-upgrade`：通过，1 个测试。
- `npm run test:e2e -- --workers=1`：通过，137 个测试，约 5.3 分钟。
- `git diff --check`：通过。
- Supabase 空库全量 migration reset：通过；账号 AI 偏好恢复 migration 与三个 Companion 票据外键索引 migration 均成功应用。
- Supabase 生产核验：账号 AI 偏好表存在、4 条 RLS 存在、trigger 指向 `tripmap_private`、authenticated CRUD 授权存在。
- Supabase advisors：三个缺失外键索引已消除；剩余 leaked-password protection、fail-closed secrets table、双 SELECT policy 和低使用率索引记录为后续项。

本轮全量自动化覆盖新增的 UI 收敛、票据画廊顺序、真实图片缩略图、全局 AI 票据直达与自动收起、长文本防溢出、PWA 用户确认更新、provider runtime typecheck 和 CI artifacts。

远端 GitHub Actions、Cloudflare Pages 同 SHA 结果在本提交推送后复核。实体机结果仍不得由自动化假填。

---

历史记录：2026-07-05

## 自动化基线

- 移动端 E2E：保留 `Mobile 390x844` 作为完整套件。
- 桌面 smoke：新增 `Desktop Beta Smoke 1440x900`，覆盖 Home、Trip、Day Map、Item、Ticket、Ledger、Documents、Settings 和 AI 确认边界。
- PWA 升级：新增真实构建 `dist` 的 service worker v1 到 v2 升级 smoke，验证 IndexedDB 数据保留。
- CI：required checks 保持 `Lint`、`Type Check`、`Unit Tests`、`Build`、`E2E Tests`，Node 升级到 24。

## 生产 Smoke 事实

- Supabase Companion smoke：通过，测试数据已清理。
- Supabase 双设备 intelligence smoke：通过，覆盖设备 A 上传、设备 B 全新恢复、latest-wins 和 tombstone 删除传播。
- Provider proxy hardening smoke：生产与预览均验证 Origin 拒绝和 Bearer 拒绝路径；未进行高成本真实 provider 压测。
- Cloudflare provider maintenance worker：已部署小时级 cron。
- Shared Trip 成员资料、按人票据原件授权、撤销审计和空指定名单语义的生产 migration `20260705093000_companion_member_profiles_ticket_visibility.sql` 已部署；随后追加 `20260705132000_fix_companion_ticket_grant_policy_recursion.sql`，修复票据授权 policy 与 `cloud_ticket_blobs` policy 之间的递归。
- Supabase post-DDL 诊断：`supabase db lint --linked --schema public,storage --fail-on error` 通过；schema SQL 检查确认成员资料列、票据授权/审计表、公开/私有 RPC、授权 helper 和 realtime publication 均存在。Security advisor 仅剩 Free 计划泄露密码保护 warning；performance advisor 新增 `cloud_ticket_blobs` 双 SELECT policy warning，这是 owner 自有票据与同行授权票据共存导致的已知性能提示。
- Companion 真实账号可见性 smoke：通过并清理测试数据。覆盖真实主人账号、临时 JUAN/DONGJUN auth 用户、JUAN 专属 PDF 票据上传、成员资料与票据摘要按人可见、DONGJUN 完全不可见、JUAN 打开原件写入审计、撤销后新会话无法再下载。
- Companion realtime smoke：通过并清理测试数据。临时同行订阅 `companion_shared_members` 后，主人更新成员资料可通过生产 Realtime 收到 UPDATE。
- Companion mutation smoke：通过并清理测试数据。临时 collaborator 权限同行提交普通 `update_item` mutation，主人可读取 pending 变更并标记 applied，同行可看到处理状态回写。

## 本 PR 本地验证

- `npm run build`：通过。Vite 仍提示部分 chunk 大于 500 kB，这是既有 bundle size 警告。
- `npm run lint`：通过。
- `npm run test:unit`：通过，179 个文件、1426 个测试。
- `npm run test:unit -- src/lib/companion.test.ts src/components/trip/SharedTripPanel.test.tsx`：通过，19 个测试，覆盖空指定名单、成员资料、按人票据摘要、打开原件审计和移除成员撤销授权。
- `npx playwright test e2e/shared-trip.spec.ts`：通过，3 个测试，覆盖同行留言/协作同步、JUAN/DONGJUN 票据和资料隔离、原件打开审计、冲突建议脱敏。
- `npm run test:e2e:desktop-smoke`：通过，1 个测试。
- `npm run test:e2e:pwa-upgrade`：通过，1 个测试。
- `npx playwright test`：通过，136 个测试。
- `git diff --check`：通过。
- `supabase db reset --local` + `supabase db lint --local --schema public,storage --fail-on error`：通过；本机已用 Homebrew + Colima 配好 Docker 运行时，`supabase start --exclude vector` 可启动本地栈并应用所有本地 migrations。仅返回 Supabase storage 内置函数 warning。

备注：2026-07-05 本轮全量 E2E 由 Playwright webServer 直接管理并通过；未保留额外 dev server。

## 实体机检查

实体机结果必须人工补录，不得由自动化假填。

| 设备 | 浏览器 | 状态 | 记录 |
| --- | --- | --- | --- |
| iPhone | Safari | 待人工补录 | 需检查登录、PWA 添加到主屏幕、Trip/Day/Ticket/Settings、刷新更新 |
| Android | Chrome | 待人工补录 | 需检查登录、Trip/Day Map、Item、Ledger、Documents、PWA 刷新 |

截图和录屏保持未跟踪，不提交到仓库。
