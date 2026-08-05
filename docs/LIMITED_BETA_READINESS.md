# Limited Beta Readiness

更新时间：2026-08-05

## 结论

当前代码达到 Limited Beta Release Candidate。UI V3 候选代码 `3a9fb8c` 已完成本地浏览器、自动化和 S1-S3 结构资格；已推送结构基线 `73fe5af` 的同 SHA GitHub required checks 和 Cloudflare Pages Preview 通过。包含 S2-S3 的最终分支头、实体机与合并后的 Production 尚未完成。cloud-first 写入、Realtime 订阅、统一实时事实和 AI job runtime 仍是路线图 v5 工作，不能将当前 Beta 描述为完整实时产品。UI 发布收据见 [M6 完成度审计](UI_V3_M6_COMPLETION_AUDIT.md)。

## 验收矩阵

| 区域 | 状态 | 当前证据 | 发布边界 |
| --- | --- | --- | --- |
| Trip / Day / Item | 就绪 | 核心导航、时间轴、地图、详情和移动端溢出 E2E | 路线是预览，不是导航 |
| Ticket Library | 候选就绪 | 编辑式预览列表、真实缩略图、筛选/编辑/预览 E2E | OCR 和钱包导入后续 |
| 全局 AI | V1 就绪但有限 | 票据、地点、行程修复的注册表校验、预览、确认、stale guard 和部分失败 E2E | 只能执行登记动作，不是任意自主代理 |
| AI Draft / Edit / Repair | 就绪但需确认 | schema validation、diff、stale guard、二次确认 | 不自动写库，不读取票据原件 |
| Place / Route / Search | 就绪但依赖 provider | proxy 合同、Auth/Origin/quota、失败语义测试 | 实时事实必须有来源 |
| PWA | 就绪 | 当前连续三版本、两个固定历史生产产物、双标签收敛、IndexedDB 保留、配额压力恢复和按需缓存测试 | 地图/provider/cloud 首次使用不离线 |
| Cloud / Shared Trip | 就绪但需运营观察 | RLS、对象同步、离线恢复在线续传、票据 Blob、Companion smoke | 不是端到端加密或无冲突实时协作 |
| Supabase schema | 就绪 | 空库重建、生产 SQL 检查；2026-08-05 只读复核 migrations 与 security/performance advisors | 本轮无 DDL；剩余 advisor 均已记录 |
| CI / E2E | 本地最终候选通过 / 远端结构基线通过 | 191/1578 unit、175/175 E2E、5/5 PWA、可执行 Golden、bundle/PWA budget、真实 runtime typecheck；`73fe5af` 同 SHA CI/Preview 通过 | 包含 S2-S3 的最终分支头仍需保持全绿 |
| 实体机 | 待完成 | 自动化覆盖移动视口；iOS 26.5 Simulator 与 Android API 33 Emulator 已补充验证核心页面、地图和 AI 键盘布局 | iPhone Safari/PWA 与 Android Chrome/PWA 仍需实体机人工记录 |
| Realtime Cloud | 目标能力 | 当前对象同步、outbox 和恢复 E2E | 尚无统一 cloud-first ack、revision 和 Realtime 订阅 |
| Realtime Facts | 目标能力 | Place/Route/Search 基础合同 | 天气、航班、铁路、票务和统一 TTL/source 模型待接入 |
| AI Job Runtime | 目标能力 | 当前同步 Action Gateway | 异步 job、跨设备进度和后台恢复待实现 |
| UI V3 | 候选本地完成 / 远端待最终头复验 | 四项导航、阶段化 Today、Toolbar AI、Action Sheet、资料编辑式列表、S1-S3 结构边界、五视口与四页面像素 Golden、Reduced Motion | 实体机与同 SHA Production 后才转为 Current |

## 发布必过

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`
- `npm run test:e2e:pwa-upgrade`
- `npm run test:e2e`
- `git diff --check`
- GitHub Actions 五个 required jobs 全绿。
- Cloudflare Pages production 指向同一提交。
- Supabase migration、RLS、授权和 advisors 复核。
- iPhone Safari、iOS 主屏 PWA、Android Chrome 补录。

## 必须保持的系统合同

- 只读查询自动执行；可逆组合写入一次确认；高风险外部副作用独立确认。
- 搜索没有来源就不声明实时营业时间、票价、闭馆或交通状态。
- Provider key、Authorization、原始 provider body 和 stack trace 不进入 UI、构建产物或报告。
- 票据文件、完整数据库、route cache 和 cloud token 默认不发送给 AI。
- 云端删除、敏感文件操作和高成本 provider 动作保持用户触发。
- 更新 PWA 必须由用户确认刷新。

## 已知非阻塞项

- MapLibre 独立 chunk 首次使用仍需网络；自动化已覆盖中断、配额不足和多标签连续升级，实体机弱网体验仍需记录。
- Provider 本地合同仍是共享 chunk；后续只在收益明确时按操作拆分，不能削弱本地校验。
- Supabase leaked-password protection 需要按 [Auth 密码安全指南](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)完成计划/配置决策。
- `travel_inbox_connector_secrets` 启用 RLS 但无客户端 policy 是有意 fail-closed；[advisor 信息项](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)保留，不为消除提示开放读取。
- `cloud_ticket_blobs` 双 SELECT policy 需按 [policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)先在预览环境验证等价合并。
- [低使用率索引提示](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)需真实负载证据后再决定是否删除。
- Action Gateway 后续动作、统一 undo/history 和更完整的跨模块事务属于后续版本。
- 当前账号同步不是路线图 v5 的 Realtime Cloud Core；需要 revision、mutation ID、server ack 和订阅矩阵。
- 当前实时 Provider 覆盖有限，不能承诺天气、航班、铁路、票务或实时交通完整性。

## 回滚

- 前端回滚到上一 Cloudflare Pages 生产部署。
- Provider 通过 D1 control 关闭 `global`、`ai`、`search`、`place`、`route` 或 `fx`。
- 数据迁移只使用前向修复；不删除现有表、票据 Blob 或用户对象。
- 发现 secret 泄露时先轮换，再恢复 provider。
