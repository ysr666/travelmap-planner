# Limited Beta QA 记录

日期：2026-06-22

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

## 本 PR 本地验证

- `npm run build`：通过。Vite 仍提示部分 chunk 大于 500 kB，这是既有 bundle size 警告。
- `npm run lint`：通过。
- `npm run test:unit`：通过，168 个文件、1347 个测试。
- `npm run test:e2e:desktop-smoke`：通过，1 个测试。
- `npm run test:e2e:pwa-upgrade`：通过，1 个测试。
- `PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_WORKERS=1 npm run test:e2e`：通过，127 个测试。
- `git diff --check`：通过。

备注：直接由 Playwright webServer 管理的全量 E2E 曾在本机中途出现 preview server `ERR_CONNECTION_REFUSED` 级联失败；最早失败用例单跑通过。改为手动启动稳定 preview server 并设置 `PLAYWRIGHT_REUSE_SERVER=1` 后，全量通过。

## 实体机检查

实体机结果必须人工补录，不得由自动化假填。

| 设备 | 浏览器 | 状态 | 记录 |
| --- | --- | --- | --- |
| iPhone | Safari | 待人工补录 | 需检查登录、PWA 添加到主屏幕、Trip/Day/Ticket/Settings、刷新更新 |
| Android | Chrome | 待人工补录 | 需检查登录、Trip/Day Map、Item、Ledger、Documents、PWA 刷新 |

截图和录屏保持未跟踪，不提交到仓库。
