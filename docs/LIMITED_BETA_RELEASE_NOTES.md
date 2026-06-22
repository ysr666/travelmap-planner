# Limited Beta 发布说明

版本日期：2026-06-22

## 本轮新增

- 全局登录门禁与账号数据隔离：业务页面需要登录；本机数据库、路线缓存和用户派生状态按账号 hash 分区。
- Phase 12F 时间语义收口：明确 PlainDate、WallClockTime、Instant 和 IANA 时区；Trip/Day/Item 可表达时区；DST 自动校正和跨日交通解析有测试覆盖。
- Provider 生产加固：生产和可信预览环境启用 Origin 拒绝、Bearer 检查、Supabase Auth 验证、IP/账号/全局 D1 配额、每日预算和 D1 kill switch。
- Unified Trip Intelligence Packages 1-7：统一建议、动作、完成记录、IndexedDB v10 持久化和对象同步已经进入主路径。
- Finance 接收端职责收敛：Ticket/Inbox 费用证据确认后只生成 `draft + needs_review`，Ledger 不再后台扫描来源。
- QA 基线扩展：保留 390x844 移动端全量 E2E，新增 1440x900 桌面 Beta smoke 和真实构建 PWA v1 到 v2 升级测试。

## 已验证

- Supabase Package 7 migration、生产权限加固 migration 和 Companion owner 前向修复已部署。
- Companion 真实账号 smoke 与双设备 intelligence smoke 通过并清理测试数据。
- Provider D1 migration 已部署，生产/预览 Pages 配置已启用 Auth、Origin allowlist 和环境模式。
- Provider 生产 smoke 验证无 Origin/伪造 Origin 被拒绝，无 Bearer/伪造 Bearer 被拒绝。
- `main` ruleset 已要求 PR、禁止 force push/删除，并要求 `Lint`、`Type Check`、`Unit Tests`、`Build`、`E2E Tests`。

## 已知限制

- 真实 travel search 仍不能承诺实时信息；没有来源就不能声称实时事实。
- AI Trip Edit 仍是 patch plan + diff preview，不是多轮自主助手。
- 路线预览不是导航，不包含实时交通。
- 云同步不是实时协作，也不是端到端加密。
- Cloudflare 免费环境未配置可发送的预算告警邮件绑定时，D1 会记录 pending alert，硬限制仍生效。
- iPhone Safari 与 Android Chrome 实体机检查需要人工补录到 `docs/BETA_QA_RECORD.md`。

## Rollback

- 前端可回滚到上一版 Cloudflare Pages 部署。
- Provider 可通过 D1 `provider_controls` 关闭 `global`、`ai`、`search`、`place`、`route` 或 `fx` 分组。
- 如发现 provider secret 或 key prefix 泄露，先 rotate key，再恢复 provider。
