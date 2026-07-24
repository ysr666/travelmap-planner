# 旅图 TripMap 路线图 v4

更新时间：2026-07-24

## 北极星

旅图的主体验是“打开就看到行程，需要时一句话完成明确任务”。路线图不再按页面堆功能，而按用户旅程、AI 动作闭环、可靠性和发布证据推进。

长期不变的边界：

- 核心页面优先显示行程、地图、地点和票据；建议、资料诊断、设置和新增表单默认收起。
- IndexedDB 仍是本地首写层；Supabase 是账号同步与共享能力，不伪装成无冲突实时协作。
- AI 写入、搜索、路线、云端删除和敏感文件操作按风险确认。
- 无来源不声明实时事实；provider secret 不进入浏览器。
- 新能力必须复用现有 action executor、provider proxy、privacy guard 和时间语义。

## Phase 0：Limited Beta 收尾

目标：让当前主线成为可复现、可回滚、同一提交可验证的发布候选。

已完成：

- 核心页面信息层级收敛：每日助手、实时状态、设置二级项和新增票据默认折叠。
- 票据画廊前置、真实图片缩略图、长文本移动端防溢出。
- 全局 AI 的票据直达、完成后收起、宽泛“打开票据”进入画廊。
- 地点查询、行程一键修复和 provider 错误语义回归。
- PWA 改为用户确认刷新；构建显示版本与短提交 SHA。
- CI 覆盖前端、Pages runtime 和 Worker TypeScript，E2E 保留失败 artifacts。
- Supabase 账号 AI 偏好 migration、RLS、授权和外键索引补齐。
- 本地 typecheck/lint/unit/build/PWA/full E2E 全绿。

退出条件：

- `main` 同一 SHA 的 GitHub Actions 与 Cloudflare Pages 全绿。
- 生产 provider diagnostics 无缺失绑定或 kill switch 异常。
- iPhone Safari 与 Android Chrome 实体机 QA 有明确通过/阻塞记录。

## Phase 1：真实设备与 Beta 运营

周期：1-2 周。

- iPhone Safari、iOS 主屏 PWA、Android Chrome 回归登录、导入、Trip/Day/Item、票据、更新和离线恢复。
- 使用 Beta 账号完成一套真实英国行程导入与日常查看测试，记录 provider 请求数和失败语义。
- 增加 release smoke 清单：登录、地点候选、AI 预览、票据原件、云同步、更新提示、回滚。
- 建立最小隐私安全的错误遥测，只记录 operation、状态码、阶段、耗时和部署 SHA。
- 明确 Beta 反馈入口、严重级别和回滚负责人。

退出条件：连续两个生产版本无 P0/P1 数据丢失、越权、更新死循环或核心 provider 全面不可用。

## Phase 2：Universal AI Action Gateway

周期：2-4 周。

目标：让全局 AI 从有限命令路由升级为统一、可审计的产品动作入口，同时保持 UI 简单。

- 建立 versioned action registry：动作 schema、权限、风险等级、preview、confirm、execute、undo。
- 所有页面动作通过稳定 deep link/selection contract 返回目标页面、对象和焦点位置。
- 支持多步骤计划，但每一步都经过本地能力检查；不能执行时给出一个短原因和可完成的下一步。
- 搜索结果必须携带来源与时间；地点、路线、AI、票据、云同步使用各自 quota 和 privacy policy。
- 为跨模块事务增加 idempotency、partial failure、重试和操作历史。
- 先覆盖高频任务：找/开票据、补地点、修复行程、调整时间、生成路线预览、创建费用草稿、打开资料。

退出条件：高频动作 E2E 覆盖、无未确认写入、可恢复部分失败、动作日志不含敏感数据。

## Phase 3：性能与 PWA 可靠性

周期：2-3 周。

- 按路由拆分主应用，延迟加载 MapLibre、OCR/PDF、导入和低频设置模块。
- 建立 bundle budget、首屏加载和交互时间基线，CI 对显著回归报警。
- 优化 service worker precache，验证从多个历史版本升级和 IndexedDB 保留。
- 增加弱网、离线、恢复在线、旧标签页和多标签页升级测试。
- 补充生产缓存头、静态资源不可变版本和部署 SHA 诊断。

退出条件：核心行程首屏不被地图/OCR包阻塞，PWA 升级无强制循环或数据丢失。

## Phase 4：账号数据与运营加固

周期：2-4 周。

- 在 Supabase 预览分支合并 `cloud_ticket_blobs` 等价 SELECT policy，消除重复 permissive policy。
- 评估并启用 leaked-password protection；保留 `travel_inbox_connector_secrets` fail-closed。
- 建立 migration history reconciliation，统一 CLI/MCP 生成版本与仓库文件记录。
- 增加同步队列诊断、设备/操作审计、失败重试和协议迁移工具。
- 为导入、同步、票据文件和 Companion 增加恢复演练与数据完整性检查。

退出条件：advisors 无未解释高风险项，迁移可从空库重建，生产恢复步骤完成演练。

## Phase 5：旅行能力扩展

周期：4-8 周，按 Beta 反馈排序。

- 票据：更快的全屏预览、可控 OCR、二维码/关键信息抽取、隐私分级。
- 地图：更清晰的行程范围、用户位置、marker 分类、批量候选确认和导入后路线队列。
- Inbox/资料：来源连接器运营化、重复检测、旅行归属确认和可撤销导入。
- 时间：AI ISO datetime 显式映射、跨时区交通解释和 DST 边界 UI。
- Shared Trip：更完整的主人审计、冲突处理和成员权限说明。

## 接下来五项

1. 完成当前 `main` 同 SHA 的 CI、Cloudflare 和 production diagnostics。
2. 用 iPhone Safari 与 Android Chrome 补齐实体机 Beta 记录。
3. 设计并实现 Universal AI Action Gateway v1 合同和三个高频动作。
4. 拆分 MapLibre/OCR/PDF 低频 chunk，并加入 bundle budget。
5. 在 Supabase 预览环境完成 policy 合并、migration history reconciliation 和恢复演练。
