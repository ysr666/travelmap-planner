# 旅图 TripMap 路线图 v4

更新时间：2026-07-26

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
- `main` 合并提交 `5477ce6` 的 GitHub Actions 五项检查和 Cloudflare Pages 部署同 SHA 全绿。

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

V1 已完成：

- 建立 versioned action registry，覆盖动作 schema、风险、上下文、prepare、preview、execute、幂等和重试。
- 固定本地识别、必要时 AI 结构化规划、本地校验、真实预览、一次确认、依赖执行链。
- 首批登记 `ticket.open@1`、`place.enrich@1` 和 `trip.repair@1`。
- Provider 只能选择已登记动作和语义参数；本地拒绝未知动作/字段、循环依赖、敏感字段和歧义目标。
- 写入保持最终确认和 stale-state 保护；支持独立步骤继续、部分失败重试和成功步骤去重。
- 全局 AI 结果保持一句摘要、折叠步骤和一个主按钮；导航完成后自动收起。

后续：

- 把调整时间、路线预览、费用草稿和打开资料迁入注册表。
- 统一跨模块操作历史与可撤销能力，并为更多页面补稳定 selection contract。
- 继续保持搜索来源、时间、quota 和 privacy policy，不扩大 Provider 任意调用面。

V1 退出条件已满足：三个高频动作有 E2E、无未确认写入、部分失败可恢复、计划和日志不含敏感数据。

## Phase 3：性能与 PWA 可靠性

周期：2-3 周。

第一轮已完成：

- 全局 AI 与 Provider 客户端移出静态启动图；路由缓存只依赖纯路由模型。
- PDF 恢复为真正动态 chunk，MapLibre、OCR、PDF 和 JSZip 均不阻塞静态入口。
- 入口 JS 从 947.6 kB 降至 476.9 kB；初始静态 JS 为 848.2 KiB，gzip 244.8 KiB。
- 构建新增 manifest 驱动的 bundle budget，并在现有 CI `Build` 中强制执行。
- 当前 built-dist PWA 升级继续验证 IndexedDB 保留。

第二轮已完成：

- Service Worker 预缓存从约 4.15 MiB/107 项降至约 2.28 MiB/92 项。
- 核心 Trip、Day、Item、票据和资料页继续预缓存；地图、PDF/OCR、JSZip 和 AI 重资源改为首次使用后缓存。
- 加入预缓存唯一性、核心必需项、可选禁入项、运行时缓存和 2500 KiB 上限。
- built-dist E2E 验证核心页面首次离线可打开、可选资源首次使用后可离线命中，以及升级保留 IndexedDB。

后续：

- 继续拆分低频导入、设置和共享能力，评估 MapLibre 按视图加载成本。
- 建立真实设备首屏加载和交互时间基线，CI 对显著回归报警。
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

1. 用 iPhone Safari 与 Android Chrome 补齐实体机 Beta 记录。
2. 使用 Beta 账号完成真实英国行程导入、地点、AI、票据和云同步 smoke。
3. 补弱网中断恢复、多个历史版本和多标签升级测试。
4. 扩展 Action Gateway 到时间调整、路线预览、费用草稿和资料打开。
5. 在 Supabase 预览环境完成 policy 合并、migration history reconciliation 和恢复演练。
