# TripMap 完整产品级交付计划

更新时间：2026-08-13

状态：**Target；当前为 Limited Beta，尚未达到完整产品级交付**

权威关系：

- 上游产品合同：[产品定位与核心体验](PRODUCT_POSITIONING.md)
- 技术战略：[产品战略](PRODUCT_STRATEGY.md)
- 中长期路线图：[路线图 v5](ROADMAP_V5.md)
- 视觉合同：[UI V3 Design](DESIGN.md) 与 [UI V3 重构规范](UI_REFACTOR_V3.md)
- 视觉子计划：[UI V3 产品质感增强实施计划](UI_V3_PRODUCT_FIDELITY_PLAN.md)
- 当前能力事实：[项目状态](PROJECT_STATUS.md)
- 生产环境事实：[生产运行状态](PRODUCTION_RUNTIME_STATUS.md)

本文件是从 Limited Beta 走到完整产品级交付的总执行合同。它取代“固定 fixture 通过、页面像素稳定、Mock 合同通过即可称为完成”的旧判断。UI V3、Golden、Mock 和模拟器仍是必要证据，但任何生产能力只有在正式数据模型、真实账号、真实 Provider、权限、失败恢复和同 SHA 发布证据全部通过后，才能标记为 `Current`。

## 1. 先纠正完成口径

### 1.1 当前已经完成的部分

- 四项主导航、阶段化 Today、按需 AI Action Sheet、编辑式资料列表、行程日程/地图切换和响应式 App Shell 已进入生产。
- UI V3 的固定状态布局、五视口、深色、长内容、`200%` 文本、软件键盘、PWA 生命周期和模拟器基线已建立。
- Action Gateway 已有版本化计划、注册表校验、预览、一次确认、幂等、stale plan 和部分失败重试基础。
- Provider Proxy 已有 Auth、Origin、quota、daily budget、kill switch、隐私过滤和统一错误合同。
- 票据、账本、基础导入、地图、Supabase 登录/对象同步/票据 Blob 和 Shared Trip 已有 Limited Beta 主路径。

### 1.2 不能再被描述为完成的部分

| 能力 | 当前真实状态 | 不能使用的完成证据 | 产品级完成证据 |
| --- | --- | --- | --- |
| 景点、酒店、餐厅照片 | `Partial`：Place Photo 代码存在；设计照片主要是 E2E fixture | Wikimedia fixture 截图、Mock Blob | 正式账号通过真实 Place ID 获取、展示、缓存、署名、过期和降级 |
| 酒店与保险对象 | `Fixture-only / Partial`：合同存在；正式持久化和导入未闭环 | E2E session supplement | 正式导入、Supabase 持久化、同步、关联、编辑和跨设备恢复 |
| 品牌 Logo | `Partial`：仅 4 个受控品牌 | 四个固定品牌命中 | 目标市场高频品牌覆盖、来源/权利、代码解析、深浅色和未知品牌降级 |
| AI 完成任务 | `Partial`：16 个注册动作，仍有兼容路由 | 三条示例指令或关键词命中 | 所有产品内操作进入注册目录，完整自然语言语料和真实账号组合任务通过 |
| 实时事实 | `Partial`：schema 与部分 Provider 存在 | Mock 天气/地点/路线 | 真实 Place、Route、Weather、Flight/Rail 等事实带来源、时间、TTL 和失败降级 |
| 在线账号事实源 | `Target`：当前仍是 IndexedDB 首写再同步 | 单设备本地写入成功 | cloud-first ack、Realtime、冲突、重连和第二设备收敛 |
| 完整视觉质感 | `Partial`：真实组件布局已校准 | product-fidelity fixture Golden | 真实账号、真实图片、真实订单字段和稀疏/失败状态重新验收 |
| 英国 12 天真实行程 | `Not accepted` | fixture 中存在相似城市和对象 | 所有者授权账号完成真实导入、修复、执行、同步和模拟器旅程 |

### 1.3 状态词只允许以下五种

- `Current`：正式代码、正式数据路径、生产配置、真实或等价环境验收均已通过。
- `Partial`：有可运行实现，但对象覆盖、环境、失败路径或真实验收不完整。
- `Fixture-only`：只可用于开发、E2E 或视觉资格，不得进入普通生产构建或产品声明。
- `Target`：合同和方向已确定，但尚未实施或尚未完成必要迁移。
- `Historical`：仅保留历史决策，不再作为当前产品或验收依据。

任何文档不得用 `passed`、`released` 或 `Production Current` 覆盖上述状态差异。

产品缺陷严重级别：

- `Product P0`：数据丢失/泄露、越权、无法登录/恢复、整条核心旅程不可用或错误高风险写入，立即阻断发布。
- `Product P1`：收集、准备、执行、应变、同行、费用、恢复中的关键任务错误或无法完成，阻断完整产品级发布。
- `Product P2`：存在可靠替代路径，但效率、信息、视觉或可访问性明显低于产品合同，必须在正式发布前关闭或逐项批准。
- `Product P3`：不影响当前核心任务的增强项，可进入后续路线图，但不能被写成 Current。

## 2. 完整产品级交付的用户范围

完整交付必须同时覆盖以下七条真实旅程，而不是只完成四张核心页面：

1. **收集旅程**：用户从邮件、网页、HTML、XLSX、PDF、图片、ZIP 和手工输入收齐材料，系统识别旅行、对象、日期、时区、金额和关联关系。
2. **准备旅程**：系统找出真正阻塞出行的问题，自动查询可验证事实，合并生成一次修复预览并完成可逆修复。
3. **执行旅程**：用户随时能看到下一站、何时出发、怎么去和需要出示的资料，并在两次操作内打开导航或票据。
4. **应变旅程**：延误、闭馆、取消、天气和用户晚到发生后，系统核对真实影响，保留必须项和票据约束，再用一次确认调整可逆安排。
5. **同行旅程**：组织者分配安排、任务和资料权限，同行只看到与自己相关的信息，权限变化实时生效。
6. **费用旅程**：用户从票据和手工记录形成费用草稿，完成汇率、分类、分摊、退款/返现和旅行后结算。
7. **恢复旅程**：换设备、离线、弱网、PWA 升级、Provider 故障和部分写入失败后，旅行仍能恢复且不会重复、丢失或泄露数据。

产品边界保持不变：TripMap 不是 OTA、支付工具、邮件客户端或 turn-by-turn 导航器。预订、付款、取消订单、发送邮件和外部账号权限修改不属于默认自动执行范围；可以提供受控跳转或独立高风险确认，但不能伪装成已经完成的产品内动作。

## 3. 不可破坏的系统原则

1. Supabase/Postgres 是目标账号事实源；IndexedDB 是启动缓存、弱网 outbox 和应急读取层。
2. 所有用户可见操作要么进入 Action Gateway 注册表，要么明确列为不能由 AI 执行的高风险边界。
3. AI 只能选择语义目标和已登记动作，不能选择函数名、SQL、路由地址、任意 URL、数据库 ID 或敏感字段。
4. 只读动作和用户明确要求的 Provider 查询可直接执行；可逆写入合并为一次确认；权限和外部副作用单独确认。
5. 所有实时事实都有 `source`、`observedAt`、`expiresAt`、`confidence` 和受控 `rawRef`。
6. 所有媒体都有对象范围、来源、归因、权利、尺寸和有效期；Fixture、生成图和无来源图片不能冒充生产对象。
7. 票据原件、证件正文、Token、Provider key、完整数据库和私密成员数据不进入 AI 规划请求。
8. 页面丰富度来自真实对象，不来自占位媒体、长说明、重复摘要或卡片堆叠。
9. 每个写入都有 revision、mutation ID、幂等键、审计来源和恢复路径。
10. 阶段完成必须有代码、测试、真实环境收据和回退说明，不能只靠文档宣称。

## 4. P0：能力真相、验收基线与发布声明

目标：让项目状态、代码能力、环境配置和产品声明保持一一对应。

交付项：

- 以 [`config/product-capabilities.json`](../config/product-capabilities.json) 建立机器可读 `capability-manifest`，记录能力 ID、状态、负责模块、数据源、Provider、feature flag、测试和最近生产收据。
- 自动扫描普通生产构建，阻止 `fixtures/product-fidelity`、E2E session supplement、测试账号旁路和 Mock Provider 进入产物。
- 为 UI、数据、Provider、AI、同步、票据、协作和账本分别记录 `Current | Partial | Fixture-only | Target`。
- 将文档中的视觉完成、Mock 完成、真实 Provider 完成和真实账号完成拆成独立字段。
- 所有页面和 Provider 能力建立 owner、SLO、告警和回退入口。
- 记录生产环境实际启用的 Provider、配额、kill switch、数据库 migration 和客户端最低兼容版本。
- 建立发布声明检查，文档中的 Current 能力必须能反查到同 SHA CI、部署和生产收据。
- 将旧的错误完成声明改为历史收据，不删除已完成的视觉与自动化证据。

退出条件：

- 普通生产构建中 E2E fixture 和旁路引用为零。
- 所有 `Current` 项都有生产代码路径与可重复验收命令。
- 所有 `Partial` 项明确缺口和下一阶段，不再以模糊文案包装。
- `PROJECT_STATUS.md`、本计划、路线图、Design QA 和发布记录状态一致。

## 5. P1：Realtime Cloud Core 与正式数据模型

目标：让账号云端成为完整、可恢复、可协作的事实源。

详细数据、权限、mutation、冲突、Realtime、恢复、迁移和回退合同见 [Account Cloud V2](CLOUD_DATA_MODEL_V2.md)。该合同在 Preview/Production 与客户端切换完成前保持 Target。

当前本地实现进度：首批 7 个注册原子 workflow 中 6 个已有产品 adapter，包括同日重排、跨日移动、既有票据关系、新旅行 metadata 导入、现有账本 mutation 面和已确认的自适应重排；所有 rollout 硬门槛仍关闭，统一 AI repair、Preview、真实账号、Realtime、空设备恢复与生产切换均未完成。

交付项：

- 为 Trip、Day、Item、TicketMeta、Document、TransportBooking、TransportSegment、Lodging、Insurance、MediaAsset、RealtimeFact、Ledger、Intelligence、Shared Task 和 AI Job 建立正式服务端模型。
- 每个对象包含 `revision`、`mutationId`、`actorId`、`createdAt`、`updatedAt`、可选 tombstone 和 schema version。
- 在线写入改为 cloud-first commit；客户端使用 optimistic state，服务端 ack 后固化本机缓存。
- 网络失败才进入 outbox；恢复在线后按 mutation ID 自动续传并去重。
- 建立按 trip scope 的 Supabase Realtime 订阅，新增、更新、删除、权限变化和 AI job 状态跨设备收敛。
- 建立字段级冲突合同：自动合并、用户选择、服务端获胜和不可合并冲突四种结果。
- 支持从空设备恢复完整旅行、对象 metadata、票据索引、资料关联、账本、智能历史和必要私有附件。
- 为已有 IndexedDB/Supabase 数据设计可回滚迁移和分批 backfill，不强制用户重新导入。
- 建立数据保留、软删除、恢复、账户导出和账户删除流程。
- 完成邮箱 OTP、session 刷新、过期重登、跨标签登出、账号切换和网络中断后的认证恢复。
- 为所有新表、函数、Storage path 和 Realtime channel 完成 RLS、grants、索引和审计。

退出条件：

- 在线写入 P95 在 2 秒内出现在第二设备。
- 同一 mutation 重试 100 次不产生重复对象或重复费用。
- 离线编辑恢复后自动收敛，outbox 不丢、不提前清除、不覆盖较新服务端状态。
- 清除本机缓存后，正式账号能够从云端恢复全部用户可见旅行数据。
- RLS 越权、撤权后读取、跨账号对象 ID 和私有 Blob 测试全部拒绝。

## 6. P2：完整导入、收件箱与字段溯源

目标：用户把真实材料交给系统后，不需要重复录入和逐文件整理。

交付项：

- 支持文件夹、拖放、系统文件选择、HTML、XLSX、PDF、JPEG/PNG/WebP、ZIP、邮件转发和已授权连接器。
- 对每个输入执行病毒/类型/大小校验、解压限制、OCR、表格解析、正文提取和编码修复。
- 将结果分类为旅行计划、航班、铁路、住宿、门票、保险、证件、费用凭证、SIM/通信和未识别资料。
- 建立 trip/day/item/booking/ticket/document/lodging/insurance/expense 候选对象，而不是把所有内容塞入 note。
- 每个字段保留来源文件、页码/表格位置、解析方式、confidence 和用户覆盖历史。
- 识别日期、当地时间、时区、跨日、货币、机场/车站代码、订单号、座位、地址和人员范围。
- 在导入预览中合并重复对象、指出冲突、显示缺失字段和关联建议。
- 用户一次确认提交整批可逆写入；部分失败只重试失败文件或失败对象。
- 重复导入同一批材料保持幂等，不创建第二趟旅行或重复票据。
- 收件箱按“需要确认、处理失败、已归档”组织，不把技术 Provider 状态放在一级页面。
- 连接器密钥继续服务端隔离；撤权、过期和重连有明确状态。
- 建立真实复杂出境旅行 corpus，覆盖中文/英文、扫描件、长文件名、错误日期和互相矛盾的材料。

退出条件：

- 所有者授权的英国 12 天真实材料可以一次导入并形成可执行旅行对象。
- 高置信字段准确率达到 98%，对象分类准确率达到 95%，低置信结果不静默写入。
- 重复导入零重复对象；冲突字段 100% 进入统一预览。
- 单个文件失败不阻塞其余文件，刷新或换设备后导入状态可恢复。

## 7. P3：资料、票据、证件与私有文件

目标：资料页真正成为旅行所需文件的快速入口，而不是文件类型列表。

交付项：

- 图片显示真实缩略图，PDF 显示首页或指定页，HTML 显示安全快照，其他格式显示克制类型降级。
- 票据 metadata 与 Blob 独立；列表、AI 和 Provider 默认只读取最小 metadata。
- 支持名称、类别、日期、城市、订单号、人员、行程点和全文索引的本地/云端安全搜索。
- 支持票据打开、二维码页直达、目标页记忆、绑定、解绑、重新分类、重命名、归档和恢复。
- 建立版本和重复检测，保留新旧文件关系，不静默覆盖原件。
- 自动匹配 trip/day/item/booking/lodging/insurance，展示 confidence、冲突和一次确认。
- Today 和 Timeline 在需要时一键打开准确票据；宽泛目标进入已限定旅行和类别的资料列表。
- 支持离线缓存策略、云端恢复、缓存清理、重新下载和上传失败重试。
- Shared Trip 使用成员级文件授权，metadata 可见与原件可见分开控制并记录审计。
- 护照、签证、保单等敏感文件使用更严格的显示、分享、日志和截图策略。
- 导出包保留 manifest、hash、metadata、关系和恢复验证。

退出条件：

- 当前所需票据从 Today/Timeline 最多 1 次点击打开准确页。
- 图片、PDF、长文件名、离线、跨设备恢复和权限撤销全部通过。
- AI 不能读取未授权 Blob、OCR 正文或成员私有文件。
- 文件上传、恢复和 PWA 升级期间不出现原件丢失或重复。

## 8. P4：完整旅行对象与准备度模型

目标：页面、AI、地图、资料和修复共同消费同一组正式旅行对象。

交付项：

- 正式持久化 Flight、Rail、Coach、Ferry、Lodging、AttractionTicket、RestaurantReservation、Insurance、Visa/DocumentRequirement 和 Connectivity 对象。
- 每类对象定义必需字段、可选字段、敏感字段、来源、状态、生命周期和显示优先级。
- 航班/铁路包含承运方代码、服务号、出发到达当地时间、时区、航站楼/站台、登机口、座位和状态来源。
- 住宿包含地址、Place ID、入住退房、晚数、确认号、住客范围、取消规则引用和关联资料。
- 门票包含场次、入场窗口、座位、人数、二维码/票面引用、使用状态和行程点关系。
- 保险包含提供方、产品、保单号、有效期、人员范围、紧急联系方式和原件引用。
- 所有对象通过统一 ViewModel 进入 Today、Timeline、Documents、Item Detail、Search 和 AI 上下文。
- 建立 source-of-truth 决策，不在 note、structured field、临时 state 和多个表中重复维护同一事实。
- 建立准备度 issue taxonomy：缺失、冲突、过期、未绑定、不可访问、路线不可达和需用户判断。
- 现有账号对象安全 backfill，无法可靠推断的字段保持缺失并进入确认。

退出条件：

- 正式账号的航班、铁路、住宿、门票、保险和通信对象均可创建、编辑、同步、关联和恢复。
- 同一字段有唯一权威值和完整来源历史。
- 稀疏对象不会伪造信息，完整对象能够达到 Selected Target 的信息密度。
- 320px 长名称、订单号、地址和无空格字段无横向溢出。

## 9. P5：真实媒体与完整品牌系统

目标：生产页面使用当前旅行对象的真实媒体和可信品牌，不依赖测试素材制造质感。

交付项：

- Place、Hotel、Restaurant、Attraction 和 Transport 媒体只从已确认对象身份或用户私有文件获得。
- Google Places 使用受控 Place Details/Photo 引用，经 Provider Proxy 返回 Blob；客户端不接收任意图片 URL。
- 对多个候选照片按对象一致性、清晰度、方向、尺寸和重复度排序，过滤不相关、人物特写和低质量媒体。
- Hero、列表和详情分别生成或请求合适尺寸，支持 focal point、`srcset`、WebP/AVIF 策略和稳定比例。
- 记录作者、来源、权利、获取时间、TTL 和必要署名；过期后刷新或降级。
- 按 Provider 条款决定服务端缓存、浏览器缓存和是否允许长期派生，不违反 Google 或其他供应商政策。
- 图片失败、离线、Save-Data、额度耗尽和对象无图时保持专业无图布局，不回落到测试照片。
- 扩展版本化 Brand Registry，覆盖目标市场高频航司、英国/欧洲铁路、保险商和酒店集团。
- 品牌解析只使用 IATA/ICAO、运营商代码、结构化 provider code 和审核别名。
- Logo 优先使用官方品牌资源或许可清楚的受控资源，记录 rightsRef、版本、适用地区和 trademark 说明。
- 支持原色、单色、浅色、深色和小尺寸可读版本；无法识别时使用通用图标与名称。
- CI 校验媒体 hash、尺寸、MIME、像素上限、SVG 安全、来源清单和 fixture 隔离。

退出条件：

- 正式英国行程中有合法媒体来源的景点、酒店和餐厅能够显示真实对应照片。
- 所有预期承运方/保险商命中正确品牌；未知品牌零误配。
- 生产请求中任意 URL、内网 URL、重定向、错误 MIME、超大文件和 SVG 执行内容全部拒绝。
- 真实媒体加载失败不影响票据、导航和下一步主任务。

## 10. P6：Provider 与统一实时事实层

目标：所有“现在、预计、延误、关闭、天气、票价和路线”都来自可追踪且未过期的事实。

交付项：

- 建立 Place、Route、Weather、Search、FX、Flight、Rail/Transit 和 Booking/Ticket Provider adapter 接口。
- Place 覆盖身份、地址、坐标、营业时间、临时关闭、官网、电话、照片和来源。
- Route 覆盖步行、驾车、公共交通的道路几何、持续时间、距离、出发时刻和交通状态。
- Weather 覆盖当前、小时预测、降雨、体感温度、极端天气和预警。
- Flight/Rail 覆盖状态、航站楼/站台、延误、取消、变更和服务中断。
- Booking/Ticket 只在合法 API 和用户授权范围内核对状态，不抓取私有订单页。
- 所有 Provider 响应先归一为 `RealtimeFactV1`，页面和 AI 不直接消费原始 payload。
- 按事实种类定义 TTL、刷新窗口、stale-while-revalidate 和离线显示规则。
- 同一事实请求去重、并发合并、超时、重试、熔断、fallback 和成本预算统一处理。
- Provider Proxy 继续强制 Supabase Auth、Origin、D1 quota、daily budget、kill switch、字段白名单和日志脱敏。
- 建立生产配置诊断，验证 secret 存在但不打印内容，并区分缺配置、被禁用、额度、上游错误和区域网络错误。
- 每类 Provider 在预览和生产执行有上限的真实 smoke，保存状态码、耗时、来源和归一化结果，不保存 raw secret/payload。
- 建立 Provider 成本、延迟、错误率、缓存命中率和事实新鲜度监控。
- 对用户明确启用的近期航班、铁路、天气和营业对象建立有界后台监测，不对整趟旅行无限轮询。
- 将事实变化归一为去重的 change event，记录旧值、新值、来源、影响范围和首次发现时间。

退出条件：

- 所有用户可见实时事实 100% 带来源、观测时间和有效期。
- 过期事实不会显示成当前；无来源时不作实时声明。
- 正式登录会话中的 Place、Photo、Route、Weather、AI 和已选交通 Provider 真实 smoke 通过。
- Provider 不可用时主旅行流程仍可读取已缓存对象，并显示短、可恢复的降级状态。

## 11. P7：AI Action Gateway V2 完整动作面

目标：用户用自然语言能够完成所有产品内可执行任务，而不是只支持少量示例指令。

### 11.1 网关能力

- 所有可点击产品命令建立对应注册动作或明确的“不允许 AI 执行”标记。
- 统一目标类型覆盖 account、trip、day、item、place、booking、segment、lodging、insurance、ticket、document、expense、member、task、fact 和 job。
- 目标解析支持当前对象、序号、日期、城市、名称、别名、类别、人员和关系；歧义目标必须停下并给最短候选选择。
- Provider 只返回 action ID、语义目标和白名单参数，不能返回路由、函数、表名、SQL、URL、Blob 或敏感字段。
- 顶层计划继续有界；复杂任务由已登记 workflow action 展开受控 child steps，不允许模型生成无限步骤。
- 增加 `read_only | provider_read | reversible_write | permission_write | external_side_effect` 风险级别。
- 只读和明确用户意图的 Provider 读取自动执行；可逆写入一次组合确认；权限和外部副作用独立确认。
- 建立服务端 action catalog、capability snapshot、计划签名、状态指纹和跨设备幂等。
- 长任务进入 AI Job runtime：`queued | running | needs_input | awaiting_confirmation | completed | partial | failed | cancelled`。
- 支持实时进度、取消、失败步骤重试、成功步骤复用、撤销和补偿。
- 计划历史只记录脱敏参数、影响对象、结果和错误类别，不记录票据正文或 Provider raw payload。
- 只有没有可执行动作且确实属于问答时才调用简短回答；事实型回答必须带来源，并优先提供相应对象或动作入口。
- 全局 AI、对象上下文 AI、主动变化和修复入口共享同一 catalog、目标解析、风险、确认与历史，不保留页面私有旁路。

### 11.2 必须覆盖的动作目录

以下是完整交付所需的动作面，不是三条示例。动作 ID 在实现时按兼容性决定保留 `@1` 或升级版本。

#### 上下文、搜索与导航

- `workspace.open`、`object.search`、`object.show`、`object.source.show`
- `trip.select`、`trip.summary.show`、`trip.next_action.show`
- `history.list`、`action.history.open`、`job.status.show`、`job.result.open`

#### 旅行生命周期

- `trip.create`、`trip.import`、`trip.rename`、`trip.dates.update`
- `trip.timezone.update`、`trip.preferences.update`、`trip.duplicate`
- `trip.archive`、`trip.restore`、`trip.readiness.scan`、`trip.repair`
- 整趟永久删除只进入独立危险区，不作为普通组合 AI 动作。

#### 日期与行程点

- `day.create`、`day.date.update`、`day.title.update`、`day.reorder`
- `day.items.reorder`、`day.schedule.balance`、`day.summary.show`
- `item.create`、`item.update`、`item.time.update`、`item.duration.update`
- `item.move`、`item.reorder`、`item.delete`、`item.restore`
- `item.execution.update`、`item.replan.preference.update`
- `item.notes.update`、`item.ticket.open`、`item.conflict.resolve`
- `items.batch.move`、`items.batch.time.shift`、`items.batch.preference.update`

#### 地点与营业信息

- `place.lookup`、`place.details.show`、`place.enrich`
- `place.address.update`、`place.coordinates.update`、`place.identity.confirm`
- `place.opening.refresh`、`place.contact.show`、`place.website.open`
- `place.photo.refresh`、`place.duplicate.resolve`、`place.navigation.open`

#### 航班、铁路、住宿、门票与保险对象

- `booking.show`、`booking.import`、`booking.update`、`booking.document.bind`
- `transport.status.refresh`、`transport.terminal.refresh`、`transport.platform.refresh`
- `transport.seat.update`、`transport.disruption.assess`、`transport.replan.apply`
- `lodging.show`、`lodging.import`、`lodging.update`、`lodging.enrich`
- `lodging.checkin.show`、`lodging.contact.show`、`lodging.document.bind`
- `insurance.show`、`insurance.import`、`insurance.update`
- `insurance.coverage.show`、`insurance.emergency_contact.show`、`insurance.document.bind`

#### 资料、票据与收件箱

- `document.search`、`document.open`、`document.classify`、`document.rename`
- `document.metadata.update`、`document.bind`、`document.unbind`
- `document.duplicate.resolve`、`document.archive`、`document.restore`
- `document.export`、`document.cache.restore`、`document.sync.retry`
- `ticket.open`、`ticket.qr.open`、`ticket.bind`、`ticket.unbind`
- `inbox.list`、`inbox.classify`、`inbox.assign`、`inbox.retry`、`inbox.dismiss`
- `import.preview`、`import.commit`、`import.retry`、`import.rollback`

#### 路线、导航与实时查询

- `route.preview`、`route.refresh`、`route.mode.compare`、`route.optimize`
- `route.buffer.update`、`route.navigation.open`、`route.cache.refresh`
- `weather.refresh`、`flight.status.refresh`、`rail.status.refresh`
- `opening.status.refresh`、`realtime.stale.refresh`
- `realtime.impact.assess`、`realtime.alert.acknowledge`

#### 智能检查、修复与应变

- `readiness.scan`、`repair.preview`、`repair.apply`
- `repair.places`、`repair.routes`、`repair.times`
- `repair.timezones`、`repair.document_links`、`repair.object_fields`
- `repair.media`、`repair.realtime_facts`、`repair.sync`
- `trip.replan.preview`、`trip.replan.apply`、`trip.replan.undo`
- `conflict.list`、`conflict.resolve`、`history.undo`、`history.redo`

#### 费用、预算与结算

- `ledger.summary.show`、`ledger.expense.list`、`ledger.expense.query`
- `ledger.expense.extract`、`ledger.expense.draft`、`ledger.expense.update`
- `ledger.expense.confirm`、`ledger.expense.delete`、`ledger.expense.restore`
- `ledger.currency.convert`、`ledger.category.update`
- `ledger.split.preview`、`ledger.split.apply`
- `ledger.budget.update`、`ledger.refund.record`、`ledger.cashback.record`
- `ledger.settlement.preview`、`ledger.settlement.confirm`、`ledger.report.export`
- AI 不执行付款或真实转账。

#### 同行、任务与权限

- `member.list`、`member.invite.prepare`、`member.invite.confirm`
- `member.role.update`、`member.remove`
- `task.create`、`task.assign`、`task.update`、`task.complete`
- `ticket.access.grant`、`ticket.access.revoke`
- `comment.add`、`meeting.propose`、`meeting.confirm`
- 权限变更使用独立确认，不与普通行程写入混在一次确认中。

#### 偏好、通知、数据与应用

- `account.preferences.update`
- `notification.preferences.update`、`currency.preference.update`
- `map.provider.update`、`ai.preferences.update`
- `data.export.prepare`、`offline.cache.manage`
- `sync.status.show`、`sync.retry`、`app.update.show`

### 11.3 自然语言覆盖要求

- 建立不少于 300 条真实中文指令语料，覆盖全部动作域，而不是围绕三条示例改写。
- 至少 80 条为多步骤组合指令，40 条为歧义目标，40 条为否定/问句/what-if，30 条为失败重试，20 条为中英混合和旅行缩写。
- 覆盖“帮我处理好”“都修一下”“按最少改动重排”等宽泛目标，但必须由 readiness/preview 合同限定真实影响。
- 覆盖当前页上下文、序号、日期、城市、同行、票据类别和关系指代。
- 错别字、长句、口语、省略主语和重复指令不得绕过目标与风险校验。
- 问句、假设、否定、取消措辞和未授权成员请求默认不写入。

退出条件：

- 100% 产品内可执行命令进入动作目录或明确列为禁止 AI 执行。
- 300 条语料规划有效率至少 95%，唯一目标解析正确率至少 98%。
- 可逆写入 100% 有真实预览和一次最终确认；权限/外部副作用 100% 独立确认。
- 未知动作、未知字段、任意函数、任意 URL、内部 ID 和敏感字段接受率为零。
- 重复执行率低于 0.1%，部分失败重试不重复成功步骤。

## 12. P8：完整智能检查、一键修复与突发重排

目标：一个按钮或一句话解决所有系统可自动解决的问题，剩余问题准确送到对应对象，而不是生成大量建议文案。

交付项：

- Readiness Engine 扫描地点身份、地址/坐标、时间、时区、持续时间、路线、票据绑定、文件可访问性、对象字段、实时事实、同步和权限。
- Issue 按 `auto_fixable | confirmable | needs_user_choice | external_only | blocked` 分类。
- 自动修复前刷新必要且已授权的 Place、Route、Weather 和交通事实。
- 合并同源问题，避免一个缺失地点生成多条重复建议。
- 一次预览显示修复数量、影响日期/对象、数据来源和不能自动处理的项目。
- 一次确认执行所有可逆写入；高风险项留在对应页面，不阻塞其余修复。
- 支持 trip/day/item 范围、最少改动、保留必须项、最短路线和无障碍优先策略。
- 重排尊重营业时间、票据场次、交通衔接、最短停留、缓冲、天气适用性、同行限制和用户固定项。
- 失败步骤可重试；成功步骤复用；旅行变化后重新准备并要求新确认。
- 每次修复生成可读历史、来源、前后差异、撤销/补偿和不能修复的原因。
- 页面只显示一个紧凑状态和一个主按钮，详细问题默认折叠。
- 对用户启用监测的近期对象生成主动影响分析，只有存在可执行影响时才通知。
- 通知按事件和影响去重，支持静默时段、旅行级开关、事实类别开关和“仅提醒/准备方案/自动执行可逆动作”三个等级。
- Web Push 只携带最小摘要和对象引用，打开后重新鉴权并读取当前事实，不在通知 payload 中放票据或敏感信息。

退出条件：

- 真实英国行程所有自动可修复问题可以一次执行完成。
- 重复建议为零，修复后同类 readiness issue 不重新出现。
- 票据原件、订单、付款、成员权限和用户固定项不会被静默修改。
- Provider 失败、部分失败、stale plan、离线和撤销均有端到端测试。

## 13. P9：Today、行程、资料、详情与设置的真实数据体验

目标：把已通过的视觉框架用真实生产对象重新验收。

交付项：

- 未建旅行 Today 首要操作是导入，AI 创建和手动创建为次级入口。
- 出发前 Today 展示倒计时、唯一阻塞项、航班、住宿、保险、必要事实和一次修复。
- 旅行中 Today 展示下一站、出发倒计时、交通、票据、导航和影响当前决定的实时变化。
- 旅行后 Today 展示费用确认、同行结算、资料归档和回顾，不保留过期导航。
- 行程默认连续时间线，地图是同一日期的视图；编辑、删除、批量处理进入上下文操作。
- 资料使用真实票面/PDF 首页和结构化 metadata；待确认是紧凑筛选状态。
- 地点详情显示真实媒体或完整无图布局、地址、时间、营业状态、路线、票据和一个主操作。
- 设置一级仅展示摘要与入口，账户、同步、Provider、隐私和高级数据工具进入二级页面。
- AI 关闭时不占空间；成功导航后关闭；详细计划默认折叠。
- Loading、Empty、Sparse、Rich、Error、Expired、Offline、Permission denied 和 Long content 都有正式设计。
- 同一屏幕只有一个主操作和一个展开底部交互层。
- 全局搜索覆盖旅行、日期、行程点、订单、资料、费用和同行任务，并根据对象直接打开或给出受控下一步。

退出条件：

- 使用正式账号数据重拍全部核心页面，不注入 E2E supplement。
- 设计对照没有未关闭的 Visual P0/P1/P2；动态内容差异有来源解释。
- `320x568` 至 `1440x900`、深浅色、键盘、`200%` 文本和长内容全部无溢出/遮挡。
- 稀疏数据自然收缩，不使用长说明、假卡片或 fixture 填满页面。

## 14. P10：真实地图、路线与导航决策

目标：地图展示真实空间关系和可执行路线，不用直线或截图制造完成感。

交付项：

- 统一 Place ID、坐标、路线端点、行程点和选中 Sheet 的对象来源。
- 支持步行、驾车和可用地区的公共交通模式；路线包含真实道路/线路几何、距离和持续时间。
- 按用户明确操作或影响当前执行的变化刷新路线，不在后台无边界消耗 Provider。
- 区分 `road | transit | mixed | estimate | unavailable`，直线估算不得标成真实道路。
- 支持编号 Marker、活动路段、当前位置、重新定位、日期切换和 fit bounds。
- 远距离或低精度当前位置不拉坏行程视口；权限拒绝和定位超时有稳定降级。
- 一个地点 Sheet 聚合时间、地址、路线、票据、详情和外部导航。
- 外部导航根据平台和用户偏好生成受控链接，不接受 AI 提供任意 URL。
- 路线缓存包含 Provider、参数、时间、TTL 和 schema；过期、失败和交通变化正确处理。
- 弱网时保留最后有效路线和明确时间，不把旧 ETA 当成当前。

退出条件：

- 正式英国行程所有可路由日期显示真实几何，路线/Marker/Sheet/底栏无重叠。
- 位置、交通方式、路线刷新、失败保留和外部导航均通过模拟器 E2E。
- 地图 Canvas 非空且像素检查通过；没有直线冒充道路。

## 15. P11：费用、预算、退款与旅行后结算

目标：覆盖个人复杂旅行的费用管理，但不扩张为支付或企业报销系统。

交付项：

- 从票据、订单和手工输入形成费用草稿，原始金额、币种、日期、类别和关联对象可追踪。
- 汇率事实记录 Provider、观测时间和实际使用汇率；用户可覆盖并保留来源。
- 支持预算、已确认、待审核、退款、返现、预授权和现金支出。
- 支持同行人员范围、平均/固定/比例/自定义分摊。
- 支持重复费用检测、编辑、撤销、恢复和票据关联。
- 旅行后生成按类别、币种、人员和已结算状态的摘要。
- 结算只生成建议和确认记录，不执行真实转账或支付。
- 导出保持汇率、分摊、退款、返现和来源字段。
- AI 查询可以回答已记录数据并创建草稿，不编造缺失费用或汇率。

退出条件：

- 真实英国行程的保险、SIM、交通、住宿、门票和返现口径可以正确汇总。
- 重复导入、退款和返现不造成总额重复计算。
- 分摊、结算和导出结果与确定性计算一致。

## 16. P12：同行协作、任务与最小权限

目标：组织者和同行在同一旅行中实时协作，同时严格限制私有资料。

交付项：

- 明确 owner、editor、member、viewer 等角色及每类对象权限。
- 邀请、接受、过期、撤销、成员移除和角色变化实时生效。
- 行程、任务、评论、集合点和成员相关变更通过统一 Realtime 模型同步。
- 票据 metadata 与原件访问分别授权，支持单票据和成员范围。
- 任务支持创建、指派、截止、完成和相关行程点/资料。
- AI 只读取当前调用者有权访问的成员和对象摘要。
- AI 协调可以准备偏好冲突方案，但权限变更、成员移除和票据授权独立确认。
- 所有敏感文件访问和权限变化进入审计事件。
- 通知只发送可执行变化，不把评论、同步和诊断堆到 Today。

退出条件：

- 权限撤销后新请求立即失败，已缓存私有文件按策略清除或失效。
- 两设备并发编辑和任务更新 P95 在 2 秒内可见。
- 未授权成员无法通过搜索、AI、URL、缓存或共享链接获取资料。

## 17. P13：PWA、平台适配、无障碍与性能

目标：PWA 在真实移动环境中稳定、快速、可恢复，不只在桌面 Playwright 中成立。

交付项：

- 继续验证 `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900`。
- iPhone Simulator Safari/主屏 PWA 与 Android Emulator Chrome/WebView 作为发布设备门槛。
- 覆盖安全区、软件键盘、返回手势、文件选择、相机/相册、定位权限和外部导航。
- Service Worker 升级保持 waiting/确认/多标签收敛，不强制重载或丢失写入。
- App shell、核心旅行和必要离线票据有明确缓存；地图、实时 Provider 和敏感文件不被无边界预缓存。
- Save-Data、离线、慢 3G、请求中断和恢复联网有一致状态。
- 严重/关键 Axe 问题为零，键盘、焦点、读屏名称、对比度和 Reduced Motion 完整覆盖。
- 200% 文本、长中文、无空格英文、长地址和长票据名不产生横向滚动。
- 设定并守住入口、初始 JS、gzip、precache、媒体、地图和 AI lazy chunk 预算。
- 监测 LCP、INP、CLS、启动失败、JS 错误、Provider 延迟和 PWA 更新完成率。
- 所有日期、倒计时、跨日航段、夏令时和当地时间按对象 IANA 时区计算；不得依赖设备时区猜测。
- 完成简体中文主界面与英文专名/地址/Provider 结果混排，数字、货币、日期和无障碍名称使用一致 locale 规则。

退出条件：

- 中端移动模拟器冷启动 LCP P75 不高于 2.5 秒，INP P75 不高于 200ms，CLS 不高于 0.1。
- 完整 PWA 历史升级矩阵和离线写入恢复通过。
- 软件键盘、200% 文本和所有固定层不存在遮挡或不可达操作。
- 正式构建不包含测试 fixture、调试 secret 或未使用高成本启动模块。

## 18. P14：安全、隐私、合规、可观察性与生产运维

目标：把安全和可靠性做成默认系统能力，并能在生产中发现和恢复问题。

交付项：

- Action Gateway 对未知动作、字段、目标、依赖循环、过期计划、恶意内容和敏感字段保持 fail closed。
- Provider Proxy 对 Auth、Origin、quota、budget、kill switch、SSRF、重定向、MIME、大小和超时保持统一门禁。
- Supabase RLS、Storage、Realtime、函数 grants、security definer 和索引进入每次 schema PR 检查。
- 票据/证件、成员私有数据、AI 上下文、日志和遥测执行数据最小化与保留策略。
- 用户可以查看账号数据范围、导出数据、删除账号并撤销连接器授权。
- 品牌、照片和地图资源记录来源、权利、署名和供应商展示/缓存条款。
- 建立客户端错误、Worker 错误、Provider 失败、AI job、同步积压、事实过期和 Blob 上传监控。
- 建立按版本、Provider、操作和环境的仪表盘，不采集票据正文或完整旅行内容。
- Provider 成本预算、70%/90% 告警、自动禁用和恢复流程完成演练。
- 每个 migration、Provider 开关和客户端发布都有灰度、rollback 和数据恢复说明。
- 处理现有 Supabase leaked-password、multiple permissive policy 和索引 advisor，不能只在文档中长期接受。
- 定期运行依赖、秘密、静态、动态和 Action Gateway 安全扫描。

退出条件：

- 关键安全边界有自动化测试和一次独立安全复核。
- 生产日志、错误平台和分析事件中不含 Token、key、票据原文或完整 Provider payload。
- Provider、数据库、客户端和 PWA 回滚演练均能在不丢用户数据的情况下完成。
- 所有 Critical/High 安全问题关闭，剩余 advisor 有 owner、截止和接受理由。

## 19. P15：真实英国行程、模拟器与生产发布验收

目标：用真实复杂旅行完成最终验收，证明产品能力而不是测试素材能力。

### 19.1 真实账号验收

- 使用所有者明确授权的真实验收账号和仓库外凭据，不把邮箱、OTP 或本机文件路径写入仓库。
- 导入所有者提供的英国 12 天文件夹、HTML 行程和 XLSX 汇算材料。
- 核对旅行日期、城市、每天行程点、交通、住宿、门票、保险、SIM、费用、返现和资料数量。
- 核对跨时区、跨日交通、当地时间、夏令时和 9/10 晚等口径冲突。
- 对所有行程点执行地点身份检查；有合法来源时加载真实图片、营业信息和地图位置。
- 对每一天生成或刷新真实路线，检查交通方式、几何、持续时间和不可达状态。
- 逐个验证 Today/Timeline 的票据直达、二维码/PDF 页、离线缓存和跨设备恢复。
- 执行完整一键修复，确认所有自动项完成、需判断项准确合并、高风险项未自动处理。
- 使用至少 80 条自然语言指令覆盖导入、查询、修改、资料、路线、事实、修复、费用、同行、撤销和失败重试。
- 刷新、退出登录、重新登录、清缓存、离线编辑、恢复联网和 PWA 升级后验证一致性。

### 19.2 自动化与设备矩阵

- 单元、schema、property、合同、组件、Mock E2E、真实 Provider smoke 和真实账号 E2E 分层运行。
- 完整串行 E2E、PWA 历史升级和核心 Golden 继续作为回归门禁。
- 使用正式数据语义重新建立产品级 Golden；动态地图/照片按对象、槽位、几何和操作关系验收。
- iPhone Simulator 与 Android Emulator 均完成安装、登录、导入、Today、地图、票据、AI、离线和升级关键流程。
- 所有真实 Provider 调用遵守任务授权、调用上限、脱敏记录和成本预算。

### 19.3 发布收据

- 候选分支同 SHA GitHub required checks 全部通过。
- Cloudflare Preview、生产部署和生产 URL 冒烟指向同一候选内容。
- Supabase migration、RLS、advisors、Storage 和 Realtime 检查通过。
- D1 migration、Provider controls、quota、budget、kill switch 和生产诊断通过。
- 发布后执行短生产账号 smoke，不修改不在本次范围的用户数据。
- 发布文档记录 SHA、run、deployment、schema version、Provider smoke、回退版本和已知限制。

退出条件：

- 真实英国行程七条用户旅程全部通过，无未关闭 Product P0/P1 或 Visual P0/P1/P2。
- 正式账号不依赖 E2E fixture、Mock Provider 或本机临时 supplement。
- 所有 Current 能力都有可重复的真实环境收据。
- CI、Cloudflare、Supabase、D1 和生产 PWA 状态全部与发布 SHA 对齐。

## 20. 实施波次与依赖

| 波次 | 阶段 | 目标 | 关键依赖 |
| --- | --- | --- | --- |
| W0 真相校正 | P0 | 清除错误完成声明，锁定能力清单 | 无 |
| W1 数据地基 | P1-P4 | 云端对象、导入、资料和旅行对象闭环 | P0 |
| W2 内容与执行引擎 | P5-P8 | 真实媒体、Provider、完整 AI 动作和一键修复 | P1-P4 |
| W3 用户体验 | P9-P12 | 真实数据 UI、地图、费用和同行 | P4-P8 |
| W4 发布能力 | P13-P15 | 平台质量、安全运维和真实行程验收 | 全部前置阶段 |

并行原则：

- P1 数据模型先锁定版本和权限，P2-P4 可以在 Supabase 预览分支并行。
- P5 媒体、P6 Provider 和 P7 AI 必须拆分受保护 PR，不能与大面积视觉改动混在一起。
- P9-P12 只能消费稳定数据/动作合同，页面不得重新解析 raw Provider 或自由文本。
- P13 自动化从 W1 开始持续补齐，不能最后一次性补测试。
- P15 真实账号验收只能在前置阶段退出后开始作为发布门槛，不能再用它发现基础架构尚未实现。

## 21. 每阶段统一交付模板

每个 P 阶段开始前必须记录：

- 目标、范围、no-go、数据和权限影响。
- Current/Partial/Target 能力变化。
- 可能修改的 schema、Provider、Storage、AI 和 UI 合同。
- migration、feature flag、灰度、回退和数据恢复方案。
- Mock 测试、真实 smoke、真实账号和设备验收范围。
- 成本、性能、安全和隐私风险。

每个 P 阶段退出必须提交：

- 合并代码和 schema/合同版本。
- 单元、合同、组件、E2E、性能和安全结果。
- 真实环境收据或明确说明为什么该阶段不涉及真实环境。
- 截图/视频只作为 UI 证据，不替代数据和 Provider 收据。
- 更新后的 capability manifest、项目状态、阶段台账和回退说明。

## 22. 产品级总完成定义

只有以下全部满足，TripMap 才能从 Limited Beta 改为完整产品级交付：

1. 七条真实用户旅程全部可用并通过真实账号验收。
2. 正式数据路径不依赖 E2E fixture、session supplement、Mock Provider 或人工数据库修补。
3. 旅行、资料、订单、住宿、保险、媒体、实时事实、费用和协作对象可以云端保存、实时同步和跨设备恢复。
4. 所有产品内可执行操作进入 Action Gateway 或明确列为禁止 AI 执行。
5. 完整 AI 语料、组合计划、歧义、否定、what-if、失败重试和权限测试达到 P7 指标。
6. 地点、图片、路线、天气、交通和其他当前事实来自真实 Provider，带来源和 TTL。
7. 用户从 Today/Timeline 两次操作内完成导航或票据任务。
8. 一键修复完成全部自动可修复问题，不产生重复建议或静默高风险写入。
9. 正式英国 12 天行程在两种移动模拟器、PWA 升级、离线和跨设备场景全部通过。
10. 所有 Product P0/P1、Visual P0/P1/P2、Critical/High 安全问题关闭。
11. 性能、无障碍、Provider 成本、事实新鲜度、同步可靠性和动作完成率达到本文 SLO。
12. 同 SHA GitHub、Cloudflare、Supabase、D1、生产 PWA 和真实 smoke 收据齐全。

在这 12 项全部完成前，视觉可以称为 `UI V3 Current`，具体能力可以分别称为 `Current`，但项目整体只能称为 `Limited Beta`，不得再次称为“全部完成”。
