# Limited Beta Readiness

更新时间：2026-07-28

## 结论

当前代码达到 Limited Beta Release Candidate。核心功能和自动化已完成，`main` 同 SHA 远端验证已通过；发布阻塞只保留实体机记录。通用 AI Action Gateway V1 和首轮性能拆分已完成，更深的设备性能、PWA 缓存和云端运营能力继续在 Beta 阶段推进。

## 验收矩阵

| 区域 | 状态 | 当前证据 | 发布边界 |
| --- | --- | --- | --- |
| Trip / Day / Item | 就绪 | 核心导航、时间轴、地图、详情和移动端溢出 E2E | 路线是预览，不是导航 |
| Ticket Library | 就绪 | 画廊前置、真实缩略图、筛选/编辑/预览 E2E | OCR 和钱包导入后续 |
| 全局 AI | V1 就绪但有限 | 票据、地点、行程修复的注册表校验、预览、确认、stale guard 和部分失败 E2E | 只能执行登记动作，不是任意自主代理 |
| AI Draft / Edit / Repair | 就绪但需确认 | schema validation、diff、stale guard、二次确认 | 不自动写库，不读取票据原件 |
| Place / Route / Search | 就绪但依赖 provider | proxy 合同、Auth/Origin/quota、失败语义测试 | 实时事实必须有来源 |
| PWA | 就绪 | built-dist 连续三版本升级、双标签收敛、IndexedDB 保留、配额压力恢复、核心离线页和按需缓存测试 | 地图/provider/cloud 首次使用不离线 |
| Cloud / Shared Trip | 就绪但需运营观察 | RLS、对象同步、票据 Blob、Companion smoke | 不是端到端加密或无冲突实时协作 |
| Supabase schema | 就绪 | 空库重建、生产 SQL 检查、security/performance advisors | 剩余 advisor 均已记录 |
| CI / E2E | 就绪 | 187/1555 unit、154 E2E、bundle/PWA budget、真实 runtime typecheck | 推送后仍以同 SHA 为准 |
| 实体机 | 待完成 | 自动化覆盖移动视口和桌面 | iPhone/Android 需人工记录 |

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

## 必须保持的边界

- AI 修改先 preview，最终写入再确认。
- 搜索没有来源就不声明实时营业时间、票价、闭馆或交通状态。
- Provider key、Authorization、原始 provider body 和 stack trace 不进入 UI、构建产物或报告。
- 票据文件、完整数据库、route cache 和 cloud token 默认不发送给 AI。
- 云端删除、敏感文件操作和高成本 provider 动作保持用户触发。
- 更新 PWA 必须由用户确认刷新。

## 已知非阻塞项

- MapLibre 独立 chunk 首次使用仍需网络；自动化已覆盖中断、配额不足和多标签连续升级，实体机弱网体验仍需记录。
- Provider 本地合同仍是共享 chunk；后续只在收益明确时按操作拆分，不能削弱本地校验。
- Supabase leaked-password protection 需要计划/配置决策。
- `cloud_ticket_blobs` 双 SELECT policy 需预览环境等价合并。
- 低使用率索引需真实负载证据后再决定是否删除。
- Action Gateway 后续动作、统一 undo/history 和更完整的跨模块事务属于后续版本。

## 回滚

- 前端回滚到上一 Cloudflare Pages 生产部署。
- Provider 通过 D1 control 关闭 `global`、`ai`、`search`、`place`、`route` 或 `fx`。
- 数据迁移只使用前向修复；不删除现有表、票据 Blob 或用户对象。
- 发现 secret 泄露时先轮换，再恢复 provider。
