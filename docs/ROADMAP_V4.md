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

V1.1 已完成：

- 登记 `workspace.open@1`，Provider 只能选择固定语义页面，不能提供 route 或函数名。
- 登记 `item.time.update@1`，严格校验目标和 `HH:mm`；只改开始时间时保留有效的同日时长。
- 时间写入复用短预览、一次最终确认、旅行状态指纹和 Trip Intelligence 历史。

V1.2 已完成：

- 登记 `route.preview@1`，准备阶段只检查本地坐标和缓存；一次最终确认后才请求路线服务并写入缓存。
- 登记 `ledger.expense.draft@1`，只接受短标题、正数金额、ISO 币种/日期和固定类别，始终创建 `draft` / `needs_review` 记录。
- 路线与费用动作都使用语义目标、短预览、stale-state 保护和 Trip Intelligence 历史；Provider 不能指定路由、数据库 ID、付款或结算状态。

V1.3 已完成：

- 登记 `item.create@1`，只接受语义日期、短标题和可选 `HH:mm` 时间，在单次最终确认后追加基础行程点。
- 登记 `day.items.reorder@1`，只允许把语义行程点移动到同日首尾或另一语义行程点前后，不接受数据库 ID 或跨日目标。
- 新增、重排、对象同步 outbox 和稳定 ID Trip Intelligence 历史在同一 IndexedDB 事务提交；失败整体回滚，重试不重复核心数据。
- 双标签页 stale baseline、跨日 anchor、未知字段、内部 ID 和未确认写入均有本地或 E2E 回归。

V1.4 已完成：

- 登记 `item.move@1`，只接受语义行程点、来源/目标日期和固定首尾或前后位置，不接受数据库 ID、任意 patch 或函数名。
- 来源与目标日期的完整成员和顺序都进入执行基线；任一日期在预览后变化都会要求重新确认。
- 来源压缩、目标插入、对象同步 outbox 和稳定 ID Trip Intelligence 历史在同一 IndexedDB 事务提交，失败整体回滚。
- 同一次执行重试会核对两个日期的最终顺序并拒绝重复移动；390px E2E 验证确认前不写入、一次确认和零 Provider 请求。

V1.5 已完成：

- 登记 `item.delete@1` 与固定类型的 `history.undo@1`，只删除一个语义行程点，并通过同一可逆合同恢复。
- 删除与撤销保留票据元数据、票据文件、账本关联、订单和交通字段；完整日期快照、对象同步和稳定历史在同一事务提交。
- Provider 不能选择记录 ID、快照、指纹或内部状态；预览后日期变化会阻止执行，重复请求不会删除或恢复两次。
- 手动删除也复用同一合同，并在每日时间线提供紧凑撤销入口。

V1.6 已完成：

- 登记 `item.execution.update@1`，只允许把一个语义行程点设为已完成、已跳过或恢复待进行。
- 登记 `item.replan.preference.update@1`，只接受现有重排偏好枚举及有界缓冲/最短停留分钟数。
- 两类写入都使用短预览、一次最终确认、精确行程点版本基线、稳定历史和事务化对象同步；重复执行不会追加历史。
- 明确中文指令本地完成，Provider 不能输出行程点 ID、时间戳、patch、历史、指纹或任意字段；390px E2E 验证折叠详情、确认前零写入和零 Provider 请求。

V1.7 已完成：

- 登记 `trip.replan.apply@1`，只接受晚到、延误、闭馆、活动取消和不适宜天气等固定类型，以及语义目标、有界分钟数和固定重排策略。
- 用户明确报告后在本地生成真实重排结果；What-if、问句、假设、否定表达和预订/付款取消措辞保持只读，Provider 不会因这些文本获得写入入口。
- Provider 计划必须同时通过动作注册表和原始指令语义绑定校验；合法但无关的动作、日期误识别和被否定的写入都在客户端与 Proxy 双侧拒绝。
- 旅行、日期、行程点、重排偏好、票据 metadata 和账本影响进入精确确认基线；任一项在预览后变化都会要求重新预览。
- 仅变化行程点、突发事件、可撤销重排记录、对象同步 outbox/state、旅行时间戳和稳定历史在同一 IndexedDB 事务提交，失败整体回滚；撤销只覆盖本次变化项。
- 跨午夜延误不静默改写下一日，改为短警告并要求手动处理；预览明确显示目标时间或跳过结果。
- 重试会同时验证稳定 marker、事件、记录、策略和完整应用后快照；票据文件、账本、订单、付款与交通记录始终不改动。
- 本地引擎把延误限制在受影响日期，拒绝跨午夜的隐式回绕，并避免跨日移动或局部路线重排产生重复顺序。
- 390px E2E 验证短摘要、折叠步骤、一次确认、确认前零写入、真实重排后可撤销记录和零 Provider 请求。

后续：

- 把其他高频行程编辑和复杂账本操作迁入注册表。
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

- Service Worker 预缓存从约 4.15 MiB/107 项降至约 2.21 MiB/94 项。
- 核心 Trip、Day、Item、票据和资料页继续预缓存；地图、PDF/OCR、JSZip 和 AI 重资源改为首次使用后缓存。
- 加入预缓存唯一性、核心必需项、可选禁入项、运行时缓存和 2500 KiB 上限。
- built-dist E2E 验证核心页面首次离线可打开、可选资源首次使用后可离线命中，以及升级保留 IndexedDB。

第三轮已完成：

- 将 Provider 客户端拆为轻量同步 facade 与 31.7 KiB 网络执行实现；只有真实 Provider 操作才动态加载网络实现。
- Provider 配置、错误类型、本地 schema 和确认门槛保持不变，Trip/Day/Item 核心离线路径不依赖网络执行 chunk。
- 构建和 built-dist E2E 会阻止 Provider 网络执行实现重新进入预缓存。
- GitHub Actions 官方 checkout、setup-node 和失败 artifact actions 升级到 Node 24 运行时。

第四轮已完成：

- built-dist E2E 覆盖双标签页升级：确认前两个标签继续使用旧版本且不重载，确认后统一切换并保留 IndexedDB 数据。
- 按需资源首次下载被连接中断时不会进入运行时缓存；恢复在线后可重试、完整缓存并离线复用。
- PWA 导航切换期间的测试读取可容忍真实 `controllerchange` 重载，不再把预期导航竞争误报为失败。

后续：

- 继续拆分低频导入、设置和共享能力，评估 Provider 合同按操作拆分与 MapLibre 按视图加载成本。
- 建立真实设备首屏加载和交互时间基线，CI 对显著回归报警。
- 增加多个历史发布版本连续升级、离线编辑后恢复在线和缓存配额压力测试。
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
3. 补多个历史发布版本连续升级、离线编辑后恢复在线和缓存配额压力测试。
4. 扩展 Action Gateway 到更多高频行程编辑和复杂账本操作，并继续统一可撤销合同。
5. 在 Supabase 预览环境完成 policy 合并、migration history reconciliation 和恢复演练。
