# 旅图 TripMap 项目状态

更新时间：2026-07-24

## 发布判断

旅图当前处于 **Limited Beta Release Candidate**。核心旅行、票据、地图、账本、导入、账号同步、共享旅行、AI 操作入口和 provider proxy 已形成完整主路径；本轮完成了 UI 收敛、AI 直达动作、PWA 更新语义、CI 类型检查修复、Supabase 迁移补齐和全量自动化回归。

发布仍以同一提交同时满足以下条件为准：

- GitHub Actions 的 `Lint`、`Type Check`、`Unit Tests`、`Build`、`E2E Tests` 全部通过。
- Cloudflare Pages 生产部署成功并指向同一提交。
- Supabase 迁移、RLS、授权和 advisors 已复核。
- iPhone Safari 与 Android Chrome 实体机结果补录到 [BETA_QA_RECORD.md](BETA_QA_RECORD.md)。

## 产品定位

旅图是面向出境旅行的本地优先行程工具。用户打开应用首先看到行程、当天安排和票据，而不是大段建议或系统说明。

- IndexedDB 是此设备离线缓存与首写层。
- Supabase 提供账号隔离、对象同步、票据文件和共享旅行能力。
- PWA 缓存 app shell，不承诺地图、搜索、路线或云端能力离线可用。
- AI、地点、搜索和路线通过后端 provider proxy；写入和高成本动作保留确认边界。
- 旅图不是订票平台、完整导航软件，也不把无来源的模型回答包装成实时事实。

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
- 全局 AI 可执行已登记动作：打开页面/票据、定位具体票据、查看摘要、生成预览、进入确认流程；完成跳转后自动收起。
- AI Trip Edit 使用受限 patch plan、diff、stale-state 检查和最终确认，不直接写库。
- AI Draft generation/repair、导入预览、zip 归档和 HTML/XLSX/票据导入主路径。
- 地图、道路路线预览、本地路线缓存和失败直线回退。
- 旅行账本、预算、费用草稿、分摊和结算。
- Supabase 登录、账号隔离、对象同步、票据 Blob、Shared Trip、成员级票据授权与审计。
- PWA 发现新版本后提示用户刷新，不在未确认时强制重载。

## AI 与 Provider 边界

当前全局 AI 是“统一意图入口 + 有限动作目录”，不是可以任意调用所有内部函数的自主代理。

- 明确可识别的导航、票据、摘要和本地预览动作会直接执行。
- 修改行程、AI 生成/修复、搜索和 provider-backed 动作按风险进入发送确认、结果预览或最终写入确认。
- 实时营业时间、票价、闭馆、交通中断、评价和活动必须有来源；无来源就不作事实声明。
- AI 默认不发送票据文件、完整本地数据库、route cache、cloud token 或 provider secret。
- 任意自然语言到通用工具调用、跨模块事务编排和统一 undo/history 仍属于后续 Action Gateway 工作。

## 工程基线

2026-07-24 本地基线：

- `npm run typecheck`：通过，覆盖前端、Pages provider runtime 和 Travel Inbox Worker。
- `npm run lint`：通过。
- `npm run test:unit`：180 个文件、1447 个测试通过。
- `npm run build`：通过。
- `npm run test:e2e:pwa-upgrade`：1 个测试通过。
- 全量 Playwright：137 个测试通过，耗时约 5.3 分钟。
- `git diff --check`：通过。

CI 已改为真正检查全部 TypeScript runtime，失败时保留 screenshot/video/trace，并取消同分支过时运行。应用版本同时显示短提交 SHA，方便确认浏览器是否运行当前部署。

## 云端状态

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

- iPhone Safari、Android Chrome 和安装到主屏幕后的实体机回归仍需人工完成。
- 主应用和 MapLibre chunk 仍超过 500 kB；功能正确，但首屏与弱网性能需要专项拆分。
- 浏览器旧 service worker 可能显示旧 UI；当前版本改为显式更新提示，仍需生产升级观察。
- 真实 provider 可用性还依赖 Cloudflare env、供应商配额、区域网络和当前登录 session；自动化主要覆盖合同、边界、mock 和失败语义。
- 全局 AI 已覆盖当前动作目录，但不能声称“任意一句话都能完成所有功能”。

## 文档入口

- 当前路线图：[ROADMAP_V4.md](ROADMAP_V4.md)
- Beta 验收：[LIMITED_BETA_READINESS.md](LIMITED_BETA_READINESS.md)
- QA 记录：[BETA_QA_RECORD.md](BETA_QA_RECORD.md)
- Provider 合同：[PROVIDER_PROXY.md](PROVIDER_PROXY.md)
- Supabase 同步边界：[SUPABASE_CLOUD_BACKUP.md](SUPABASE_CLOUD_BACKUP.md)
- 时间语义：[TIMEZONE_AUDIT.md](TIMEZONE_AUDIT.md)
