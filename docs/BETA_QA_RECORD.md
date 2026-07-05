# Limited Beta QA 记录

日期：2026-07-05

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
