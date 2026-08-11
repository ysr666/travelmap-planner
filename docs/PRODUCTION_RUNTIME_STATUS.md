# TripMap 生产运行状态

更新时间：2026-08-11T09:05:35Z

状态：**Environment Current / Product Limited Beta**

本文件只记录脱敏后的生产环境事实与发布收据，不代表完整产品能力已经交付。产品能力状态仍以 [`config/product-capabilities.json`](../config/product-capabilities.json) 和 [`PRODUCT_GRADE_DELIVERY_PLAN.md`](PRODUCT_GRADE_DELIVERY_PLAN.md) 为准。任何密钥值、Token、完整 Provider 响应、用户数据或内部请求内容都不得写入本文件。

## 发布基线

| 对象 | 已观察事实 | 证据 |
| --- | --- | --- |
| 生产分支 | `main` | Cloudflare Pages 项目配置 |
| 当前生产提交 | `03fc0d025da44f5cf5987a28fb57ca29555650d3` | GitHub CI run `31330978078` 成功；Cloudflare deployment `4c39e8f0-6ec0-4a2f-8d4e-b1fcf8c7e177` Active |
| P0 候选提交 | `62d995dcc4f45fee9fdd9c7c6e0ef679cf25c93c` | PR #35；GitHub CI run `31475816551` 全部成功；Cloudflare Preview deployment `e0545b7e-18fe-4d27-8b3d-adbc693632ce` 返回 HTTP 200 |
| Web 客户端版本 | `0.4.0` | `package.json` |
| 最低支持版本 | 未配置服务端强制最低版本 | 当前仅使用用户确认后的 Service Worker 升级；完整兼容与强制升级策略进入 P13 |

## Provider Proxy

2026-08-11 的生产脱敏诊断确认：

- 运行环境为 `production`，Origin 强制、Bearer/Supabase Auth 和 D1 durable quota 均已启用。
- AI 使用 `openai_compatible`；地点使用 Google Places；路线排序使用 Google Routes；路线预览优先 OpenRouteService；旅行搜索使用 Tavily；天气使用 Open-Meteo。
- AI、地点、路线、搜索、天气和认证所需服务端配置均存在。这里只记录“存在”，不记录值。
- D1 `provider_controls` 中 `global | ai | search | place | route | weather | fx` 七组均启用，无临时禁用时间。
- D1 当前无未应用 migration；`provider_daily_usage` 为 0 行，未发送告警为 0 行。本次仅执行只读查询。
- 生产预算告警发送通道尚未配置。D1 阈值事件和自动 kill switch 仍工作，但无法把 70%/90% 告警主动发送给维护者；这是 P13 发布阻塞缺口。
- 当前生产配置未启用 Mock Provider。P0 候选进一步在服务端拒绝生产环境的全局 Mock 模式和显式 `provider=mock`，Mock 仅保留在开发、单元和显式 E2E 构建中。

一分钟固定窗口限额以代码合同为准：

| Bucket | 次数 |
| --- | ---: |
| edge IP（认证前） | 120 |
| route | 60 |
| search | 20 |
| place（lookup/details/photo 共用） | 30 |
| weather | 30 |
| AI draft | 10 |
| AI draft repair/refine | 5 |
| existing-trip import | 5 |
| inbox classify | 20 |
| trip content / daily tip / operations | 10 |
| assistant answer / action plan | 20 |
| trip edit | 10 |
| FX | 30 |
| expense extract / query | 5 / 10 |

生产每日预算：

| Scope | AI | Search | Place | Route | Weather | FX |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Account | 20 | 20 | 60 | 100 | 60 | 30 |
| IP | 100 | 100 | 300 | 500 | 300 | 150 |
| Global | 200 | 200 | 600 | 1000 | 600 | 300 |

Preview 使用上述每日预算的 25%，向上取整。实际请求仍受每分钟 quota、每日预算、环境 kill switch 和 D1 控制的共同限制。

## Supabase

- 项目状态为 `ACTIVE_HEALTHY`，Postgres 17；本阶段没有执行 DDL、migration、Storage、Auth 或数据写入。
- 生产 migration 列表最新为 `20260724152320_index_companion_ticket_foreign_keys`。仓库与生产存在历史时间戳差异，名称和最终恢复 migration 已记录；P1 必须先建立可重复的全量 schema 重建与 drift 门禁。
- Security Advisor：1 个 Warning，泄露密码保护未启用；1 个 Info，`travel_inbox_connector_secrets` 开启 RLS 且没有策略。后者当前等价于拒绝 Data API 访问，但 P1 仍需验证仅受控服务路径可用。
- Performance Advisor：1 个 Warning，`cloud_ticket_blobs` 对 `authenticated SELECT` 有两条 permissive policy；另有 6 个未使用索引 Info。P1 在改变策略或删除索引前必须先验证权限语义和真实查询负载。

对应官方修复资料：[泄露密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)、[RLS 无策略](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[多条 permissive policy](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)、[未使用索引](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。

## 证据边界

- 本次未调用真实 AI、搜索、地点、路线、天气或其他上游 Provider；配置存在不等于真实结果质量已经验收。
- 本次未使用真实账号执行写入，也未修改 Cloudflare、D1 或 Supabase 配置。
- 当前环境收据证明的是“部署可达、保护边界已配置、数据面健康可读”，不是 P1-P15 的产品完成证明。
- 每次生产发布后都必须以新 SHA 更新 CI、Cloudflare deployment、Provider 脱敏诊断、D1 migration/control 和 Supabase advisor 收据。
