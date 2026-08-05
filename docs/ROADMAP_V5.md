# 旅图 TripMap 路线图 v5

更新时间：2026-08-05

产品定义：[产品定位与核心体验](PRODUCT_POSITIONING.md)

战略来源：[产品战略](PRODUCT_STRATEGY.md)

UI 规范：[UI V3 重构规范](UI_REFACTOR_V3.md)

## 总目标

把当前稳定的 PWA、账号同步、Provider Proxy 和 AI Action Gateway 基线，升级为面向复杂出境自由行组织者的 **智能旅行管家**。实时在线和 AI 优先是完成用户任务的技术方式，不是产品对外类别：

- 围绕收齐、放心、执行、应变和同行五项核心任务组织产品。
- “今日”按未建旅行、出发前、旅行中和旅行后切换唯一主任务。
- 云端账号状态成为事实源，跨设备和同行变化实时收敛。
- AI 成为统一任务入口，能查询实时信息并执行注册动作。
- 地点、路线、交通、天气、票务和订单变化都有来源与新鲜度。
- 本机 IndexedDB 保留为边缘缓存、弱网 outbox 和应急查看能力。
- 隐私与安全继续由后端合同强制，但不主导普通用户界面。

## 当前起点

已具备：

- 完整 Trip / Day / Item / Ticket / Ledger / Document / Shared Trip 主路径。
- Supabase Auth、对象同步、票据 Blob、RLS 和跨设备恢复。
- Provider Proxy 的 Auth、Origin、quota、budget、kill switch 和错误合同。
- AI Action Gateway 的版本化注册表、预览、确认、幂等、stale-state 和部分失败重试。
- Place、Route、Search 和 AI Provider 的基础适配器。
- PWA 升级、弱网恢复、历史生产迁移和完整 E2E 基线。

与目标的主要差距：

- 账号数据仍由 IndexedDB 首写后排队同步，云端不是统一实时事实源。
- Shared Trip 与账号对象缺少统一 Realtime 订阅和服务端版本合同。
- AI 仍有关键词兼容路由，动作覆盖不完整，长任务没有统一 job runtime。
- 实时地点、交通、天气、航班/铁路和票务 Provider 尚未形成统一事实模型。
- 用户仍需在多个页面手动触发查询、修复和同步。

## Phase 0：UI V3 Product Shell

状态：**Production Current; complete**

周期：5-7 周，可与 Realtime Cloud Core 的合同设计并行，但不在同一 PR 中混改数据和展示层。

目标：先把用户每天接触的 App Shell、今日、日程、地图、地点详情和票据流程收敛为产品级原生式体验，再逐步迁移低频页面。

执行合同：[UI V3 实施计划](UI_V3_IMPLEMENTATION_PLAN.md)

完成收据：M0-M6、项目所有者批准的平台模拟器验收、S1-S3 结构治理、最终候选远端、PR #33 合并、同 SHA Production 和无 Provider smoke 全部完成。UI V3 已是 Production Current；真实 iPhone/Android 为发布后运营观察。

### V3.0 设计锁定

- 使用当前真实页面和固定测试数据建立视觉基线。
- 已先锁定阶段化信息架构，并为同一产品生成 3 个独立跨场景视觉方向。
- 已在 `DESIGN.md` 锁定“第一套左上角出发前首页 + 第二套整体视觉 + 第三套资料列表”的 Selected Target；Stitch/Figma 可作协作镜像，但不作为代码实施前置条件。
- 已生成未建旅行、出发前、旅行中、旅行后、行程、地点、表单、资料、AI、费用、同行和设置的完整页面图集。

### V3.1 App Shell

- 移动端底部导航改为“今日、行程、资料、我的”；待整理材料并入资料。
- AI 从底部常驻输入框改为标题栏命令和按需 Action Sheet。
- 搜索从底部 Tab 改为标题栏或内容内的上下文命令。
- App Shell 统一管理安全区、固定导航、内容 padding 和 z-index。
- 平板使用 Rail，桌面使用 Sidebar 与主从布局。

### V3.2 核心旅行

- 首页变为阶段化“今日”：未建旅行先导入，出发前处理准备，旅行中执行下一步，旅行后完成归档。
- 日程使用扁平时间线，编辑和删除进入上下文菜单。
- 地图是日程视图切换；正在移动时可成为今日主视觉，并且一次只展开一个地点 Sheet。
- 地点详情首屏展示名称、时间、地址、导航和票据；无真实图片时不显示假 Hero。

### V3.3 资料流程

- “资料”作为一级目的地，默认显示当前旅行的票据、订单和证件。
- 待整理材料以 Badge、分区或筛选进入；无待整理项时不显示空工作队列。
- 有可预览资料时直接进入 Selected Target 的编辑式列表：左侧真实缩略图，右侧名称和关键元数据。
- 筛选、排序、连接器和 Provider 诊断进入二级 Sheet 或设置。

### V3.4 设置与表单

- Settings 一级收敛为账户与同步、旅行偏好、应用与通知、数据与高级。
- 行程点编辑默认只展开基本信息和地点，高级字段渐进披露。
- 账本、Shared Trip 和 AI Draft 复用同一组件与视觉规则。

### V3.5 产品验收

- 完成固定视口 Golden Screenshots、无障碍、性能、全量 E2E 和 PWA 升级测试。
- iPhone Simulator Safari/主屏 PWA、Android Emulator Chrome/WebView 与 built-dist PWA 生命周期各完成一轮验收。
- 静态核心页面目标 `maxDiffPixelRatio <= 0.005`，所有核心页面从 `320px` 起无横向溢出。

退出条件：

- AI 关闭时不占据内容区域，页面底部没有多层固定遮挡。
- 同一视口不重复旅行名称、日期、统计、地址或地图入口。
- 查看今日安排不超过 1 次点击，打开票据、导航和编辑行程不超过 3 次点击。
- 地点详情和票据页面首屏首先展示真实对象。
- 触控、对比度、键盘、焦点、`200%` 文字放大和真实设备记录全部通过。

## Phase 1：Realtime Cloud Core

周期：3-5 周。

目标：让在线账号状态成为主路径，并保留可靠弱网恢复。

- 为 Trip / Day / Item / TicketMeta / Ledger / Intelligence 建立服务端 revision 和 mutation ID。
- 引入 Supabase Realtime 订阅，按 trip scope 推送对象新增、更新和 tombstone。
- 在线写入改为立即提交云端；成功响应更新本机缓存，网络失败才进入 outbox。
- 建立统一 optimistic update、server ack、retry 和 rollback 状态。
- 把冲突从“同步方向选择”升级为服务端基线版本、字段合并和可审计冲突对象。
- 清除本机缓存后可从云端完整恢复旅行、票据 metadata、智能状态和必要附件。
- Shared Trip、主人端和同行端复用同一事件/版本模型。

退出条件：

- 在线写入 P95 在 2 秒内出现在第二设备。
- 重连后 outbox 自动收敛，不重复对象、不丢 tombstone。
- 同一 mutation 重试不会产生重复行程点、费用或历史记录。
- 云端不可用时 UI 明确显示降级状态，并继续允许有限缓存查看。

## Phase 2：AI Action Gateway V2

周期：4-6 周，可与 Phase 1 后半段并行。

目标：让用户通过一个 AI 入口完成绝大多数旅行任务。

- 把现有关键词兼容动作全部迁入版本化注册表。
- 增加 trip/day/item/ticket/document/ledger/shared-trip 的统一语义目标解析。
- 建立服务端 action catalog、capability snapshot 和计划签名，客户端只执行登记动作。
- 支持多步骤计划、条件依赖、并行只读步骤、一次组合确认和失败步骤重试。
- 建立异步 AI job runtime，支持 queued/running/needs_input/completed/failed 和实时进度。
- 只读 Provider 查询自动执行；可逆低风险写入一次确认；高风险外部副作用独立确认。
- 结果默认一句摘要、影响对象、完成状态和一个主按钮；详细步骤折叠。
- 统一动作历史、撤销、补偿和跨设备幂等。

首批新增动作：

- 行程批量创建、修改、跨日移动和时间重排。
- 票据/资料识别、绑定、打开和缺失信息补全。
- 预算汇总、费用草稿、分摊建议和待审核账目处理。
- Shared Trip 成员、任务、票据授权和变更处理。
- 实时异常触发的重排、通知和后续检查。

退出条件：

- Top 20 Beta 指令中至少 90% 可进入注册动作。
- 一次确认完成率达到 85%，重复执行率低于 0.1%。
- Provider 输出无法选择任意函数、路由、数据库 ID 或敏感字段。

## Phase 3：Realtime Travel Intelligence

周期：5-8 周。

目标：建立统一、可追踪、可过期的实时旅行事实层。

- 定义 `RealtimeFact`：kind、subject、value、source、observedAt、expiresAt、confidence、rawRef。
- Place 接入营业时间、官网、电话、照片和临时关闭状态。
- Route 接入出发时间、实时 ETA、交通状况和多交通方式。
- Transit 接入站点、班次、换乘、服务日和延误。
- Flight / Rail 接入状态、航站楼/站台、延误、取消和变更。
- Weather 接入小时级预测、降雨、极端天气和预警。
- Booking/Ticket 接入订单匹配、使用时间和变更状态。
- 事实缓存按 Provider 和字段设置 TTL；过期自动刷新，失败显示最后更新时间。
- AI 计划只引用已验证事实 ID，不把原始 Provider body 直接写入旅行。

退出条件：

- 所有实时事实 100% 带来源和观测时间。
- 过期事实不会继续作为“当前”状态展示。
- Provider 不可用时有清晰降级，且不会编造替代事实。

## Phase 4：Realtime Collaboration

周期：4-6 周。

目标：让同行成员在同一旅行中实时协作，而不是交换延迟快照。

- Trip presence、成员在线状态和最近活动。
- 日程、票据分配、任务和评论的实时更新。
- 权限变化即时生效，票据原件访问继续审计。
- 对同一对象的并发编辑提供字段级合并或清晰冲突。
- AI 可汇总成员偏好、识别冲突并生成一次确认的协调方案。
- 通知中心承接需要成员处理的变更，不在首页堆叠长建议。

退出条件：

- 关键协作变化 P95 在 2 秒内可见。
- 权限撤销后新请求立即失败。
- AI 协调方案不泄露未授权成员资料或票据。

## Phase 5：Proactive Trip Copilot

周期：4-8 周。

目标：AI 在用户授权范围内主动发现变化、准备动作，并把打扰控制在最低。

- 后台监测即将发生的航班、铁路、天气、营业和票务变化。
- 变化先生成影响分析和候选动作；低风险只读更新自动完成。
- 需要写入时合并成一次简短确认，不逐项弹窗。
- 用户可按旅行设置自动化等级：仅提醒、准备方案、自动执行可逆动作。
- 每个主动任务都有来源、原因、执行记录、撤销或补偿路径。
- 通知支持 Web Push，后续接入原生 iOS/Android。

退出条件：

- 主动提醒可执行率高于 70%，无动作价值的提醒率低于 10%。
- 用户可查看并关闭单类自动化。
- 高风险动作没有静默执行。

## Phase 6：Native Beta And Operations

- iPhone、Android 和 PWA 共用账号、实时事件、AI job 与 Provider 合同。
- 建立真实设备性能、推送、后台刷新和弱网恢复基线。
- 增加 Provider 成本、延迟、错误、事实新鲜度和动作完成率监控。
- 建立灰度、kill switch、Provider fallback、数据迁移和生产回滚演练。
- Supabase migrations、RLS、Storage、Realtime 和 advisors 纳入发布门禁。

## UI V3 锁定原则

- V3 是信息架构和 App Shell 重构，不是局部换肤。
- 产品定位、核心用户、旅行阶段和下一步先于视觉方向；地图和 AI 都不是固定首页身份。
- 生成式效果图只用于方向探索，真实 React 组件和 Golden Screenshots 是最终依据。
- 底部导航固定为“今日、行程、资料、我的”；AI、搜索和新增是 Toolbar 或内容命令。
- AI 结果默认一句摘要、影响对象和一个主操作；详细步骤折叠。
- 地点、票据、资料和设置采用同一层级：真实对象在一级，编辑和诊断在二级。
- Provider、同步、配额和技术性隐私说明只进入高级设置、诊断或帮助。
- 卡片只表达独立对象，普通页面区块使用留白、分组和分隔线。
- 完整规范与验收门槛以 [UI V3 重构规范](UI_REFACTOR_V3.md) 为准。

## 接下来十项

1. 为云端对象增加 revision/mutation 合同和 Realtime 订阅 PoC。
2. 把在线写入改为 cloud-first ack + IndexedDB edge cache，保留失败 outbox。
3. 建立 `RealtimeFact` schema、TTL 和来源 UI。
4. 建立 AI job runtime，并把剩余关键词动作迁入 Action Gateway 注册表。
5. 扩展 Place Provider，并接入天气、航班/铁路状态的 mock、合同和受限真实 smoke。
6. 让“一键智能修复”消费实时事实，让 Shared Trip 复用 Realtime 事件和服务端版本。
7. 建立在线延迟、Provider 成本、事实新鲜度和 AI 动作完成率仪表。
8. 观察 UI V3 生产错误、性能和 PWA 升级收敛，按同一 Golden/CI 门槛修复回归。
9. 将真实 iPhone/Android 性能、文件选择和网络差异作为可选 Beta 观察补录。
10. 在 Realtime Cloud Core 稳定后评估 Native Beta，不提前建立平行数据合同。

## 保持不变的工程底线

- 模型不能选择任意函数、SQL、路由地址或内部 ID。
- Provider 密钥和授权信息只存在于受控服务端。
- 所有事实都有来源、观测时间和过期策略。
- 写入遵守版本、幂等和风险确认；高风险外部副作用保持明确确认。
- 日志和遥测不记录密钥、完整票据原件、证件正文或原始 Provider payload。
