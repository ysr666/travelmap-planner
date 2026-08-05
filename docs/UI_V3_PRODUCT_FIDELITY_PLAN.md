# TripMap UI V3 产品质感增强实施计划

更新时间：2026-08-06

状态：**Target；P0-P2 已在功能分支完成本地验证，P3-P8 待实施**

上游合同：

- [产品定位与核心体验](PRODUCT_POSITIONING.md)
- [产品战略](PRODUCT_STRATEGY.md)
- [UI V3 设计合同](DESIGN.md)
- [UI V3 重构规范](UI_REFACTOR_V3.md)
- [路线图 v5](ROADMAP_V5.md)

## 1. 目标与发布边界

UI V3 M0-M6 已完成 App Shell、信息架构、响应式、无障碍和核心交互的生产发布。本计划不重做这些基础，而是补齐 Selected Target 中由真实旅行对象构成的产品质感：地点与酒店照片、航司与保险品牌、完整订单字段、实时状态、票据联动、精细地图、富信息页面构图和面向设计图的严格验收。

目标结果：

- 用户在“今日”首屏直接看清下一地点、出发时间、交通状态和所需资料。
- 出发前、旅行中、行程和资料四个核心状态达到 Selected Target 的信息密度、视觉重心与操作效率。
- 丰富度来自真实媒体、结构化字段和有来源事实，不来自占位图、重复摘要、长文案或卡片堆叠。
- Provider、媒体或实时事实不可用时，界面保持完整、简洁且诚实，不显示破图、不编造状态。

发布边界：

- 当前生产 UI V3 继续标记为 **Production Current**。
- 本计划及其八个工作流在各自代码、测试、截图和远端检查合并前均为 **Target**。
- 设计图不是虚构生产数据的许可。真实内容、授权、隐私、无障碍和状态正确性高于任意单个像素。
- 本计划不自动授权真实 Provider 调用、生产 schema 修改或云端配置写入；受保护改动仍需独立 PR、预览环境和明确验证。

## 2. 当前差距基线

| 能力 | 当前状态 | 目标状态 |
| --- | --- | --- |
| App Shell、四项主导航、AI Action Sheet | Production Current | 保持，不重新扩张导航与固定底部层 |
| 图片票据与 PDF 首页预览 | Production Current | 提升裁切、加载和跨页面复用，不更改票据 Blob 隐私边界 |
| 地点、酒店和餐厅照片 | Target | 仅展示来源可检查、授权可用且未过期的真实媒体 |
| 航司、铁路和保险品牌 | Target | 通过受控品牌注册表解析，未知品牌使用克制的通用图标 |
| 航班、酒店、保险和门票结构化字段 | Partial Current | 导入、匹配、确认和展示形成完整闭环 |
| 天气、航班、铁路、营业和实时 ETA | Target | 统一进入带来源与有效期的 `RealtimeFact` |
| 行程点与票据/订单自动联动 | Partial Current | 可解释匹配、一次确认、直接打开与状态同步 |
| 真实地图与路线 | Partial Current | 道路几何、活动路段、编号 Marker、位置与 Sheet 统一 |
| 设计图直接对照验收 | Partial Current | 设计图、同状态实现和稳定 Golden 三方共同验收 |

## 3. 不可破坏的原则

1. **真实资产优先。** 不用生成图、Emoji、CSS 图形、手写 SVG 或占位照片模拟景点、酒店、票面和品牌。
2. **来源与权利可追踪。** 媒体和实时事实必须记录来源、获取时间、有效期与必要署名；无合法展示依据就不显示。
3. **内容产生密度。** 通过真实对象、行、分隔线和明确层级增加信息量，不缩小文字、不重复同一信息、不恢复卡片墙。
4. **Provider 只能返回受限数据。** AI 不能选择媒体 URL、任意资源地址、函数、路由、数据库 ID 或敏感字段。
5. **写入继续确认。** 自动查询可以只读执行；匹配、绑定或更新旅行数据必须生成真实预览并只做一次最终确认。
6. **失败不破坏页面。** 图片、Logo、地图或实时 Provider 失败时保留稳定尺寸和核心文字，不出现破图、永久骨架或伪造事实。
7. **性能与弱网同等重要。** 首屏媒体按尺寸变体加载，列表延迟加载；离线只展示已缓存且仍可解释的内容。
8. **同一交互层合同不变。** AI Sheet、地点 Sheet、sticky action 和底部导航不得叠加遮挡。

## 4. 共享数据与媒体合同

以下是实施前必须锁定的逻辑合同，不代表必须立即新增数据库表。持久化方式、Supabase migration 和 IndexedDB 影响需在独立架构评审后决定。

### `TravelMediaAssetV1`

最少包含：

- `subjectType` 与 `subjectId`：只引用经过本地解析的 trip、item、booking 或 provider place 语义目标。
- `kind`：`place_photo | hotel_photo | restaurant_photo | transport_photo | document_preview`。
- `source` 与 `providerRef`：只接受注册 Provider 归一化结果，客户端不保存任意抓取地址作为可信来源。
- `attribution`、`rightsRef`、`observedAt`、`expiresAt`。
- `width`、`height`、`aspectRatio` 和可选 `focalPoint`，用于稳定裁切。
- `renderRef`：由受控媒体代理、签名缓存或本地 Blob 解析，不由 AI 生成。

安全要求：

- 媒体代理只访问登记 Provider 主机和已验证资源引用，阻止 SSRF、重定向到内网、超大文件和错误 MIME。
- 对响应执行类型、尺寸、像素和下载上限；SVG 与可执行内容默认拒绝作为远程照片。
- 票据 Blob、证件原件和 OCR 正文继续走现有私有存储边界，不进入地点媒体 Provider。
- 日志不记录签名 URL、完整 Provider 响应或用户票据内容。

### `BrandIdentityV1`

最少包含：

- `namespace`：`airline | rail | insurance | hotel_group`。
- `canonicalCode`、`displayName`、别名和可选地区。
- `logoAssetRef`、`source`、`rightsRef`、`version`、浅色/深色适配信息。

解析只使用结构化代码和受控别名表。航班号可辅助得到 IATA 航司代码，但 AI 和自由文本不能直接指定 Logo。无法可靠识别时显示通用 Lucide 图标与承运方名称，不猜测品牌。

### `RealtimeFactV1`

沿用路线图合同：`kind`、`subject`、`value`、`source`、`observedAt`、`expiresAt`、`confidence`、`rawRef`。天气、营业、航班、铁路、路线 ETA 和票务状态统一消费该合同；过期事实不得继续以“当前”状态展示。

### 结构化旅行对象

- `TransportSegment` 补齐可验证的承运方代码、出发/到达航站楼或站台、登机口、状态与状态来源。
- 住宿对象补齐名称、地址、入住/退房、晚数、确认状态和关联资料。
- 门票对象补齐入场时间、座位、订单号、票面可打开状态和关联行程点。
- 保险对象补齐保险公司、保单号、生效区间和原件引用。
- 导入识别结果必须携带字段来源和匹配置信度；歧义结果停在预览，不静默覆盖用户内容。

## 5. 八个实施工作流

### F1：真实媒体资产层

范围：

- 扩展 Place Provider 的照片字段与受控媒体读取，不使用通配 Field Mask。
- 建立地点、酒店、餐厅和交通照片的响应式变体、缓存、署名、过期和失败合同。
- 建立航司、铁路、保险品牌注册表与版本化资源清单。
- 增加共享的 `TravelObjectMedia`、`BrandMark` 和 `MediaFallback` 展示组件。

首批界面：旅行中今日 Hero、日程缩略图、地点详情、出发前酒店行、航班/保险行。

退出条件：

- Canonical fixture 的所有预期媒体槽使用可追踪资产；生产无资产时不显示假 Hero。
- 远程媒体不能绕过 Provider allowlist、MIME/大小限制和归因要求。
- 图片错误、过期和离线状态不改变行高或造成横向溢出。

### F2：旅行对象信息完整度

范围：

- 把现有 HTML、XLSX、PDF、图片和邮件导入结果归一为航班、住宿、保险、门票与交通对象。
- 为每类对象定义首屏必需字段、可选字段、敏感字段和显示优先级。
- 统一 Today、Timeline、Documents 和 Item Detail 的对象 ViewModel，消除各页面自行猜测标题和副标题。
- 缺失字段由 AI Action Gateway 调用登记动作补齐，写入继续预览和最终确认。

退出条件：

- Canonical fixture 中的航班、酒店、保险和门票均展示设计稿要求的关键字段。
- 同一事实只维护一个来源，不在票据 note、行程 notes 和页面临时状态中重复保存。
- 长航司名、订单号、地址和无空格文件名在 `320px` 起不溢出。

### F3：有来源的实时信息

范围：

- 先落地 `RealtimeFactV1`、TTL、来源展示、缓存和失效规则，再接 Provider。
- 按 Place、Route、Weather、Flight/Rail、Booking/Ticket 顺序增加 mock、合同测试和受限真实 smoke。
- “今日”只显示影响当前决定的天气或变化，不恢复大块资讯面板。
- Provider 失败显示最近更新时间和短降级状态，不生成替代事实。

退出条件：

- 所有“当前、延误、关闭、预计、天气”状态都能追溯到未过期事实。
- 过期、部分失败、额度耗尽、kill switch 和弱网均有可测试的短状态。
- Provider Proxy 的 Auth、Origin、quota、budget、privacy filter 和错误语义无回归。

### F4：资料与行程联动

范围：

- 建立 ticket/document/booking 与 trip/day/item 的候选匹配、置信度、冲突和确认合同。
- 日程和“今日”显示可操作的票据状态；点击后直接打开正确票面、二维码或 PDF 页。
- 导入完成后生成一次统一绑定预览，避免用户逐文件进入多个页面处理。
- 票据状态变化更新对象 ViewModel；不得修改票据原件、取消订单或静默覆盖用户绑定。

退出条件：

- 从“今日”或日程打开当前所需票据最多 1 次点击。
- 精确匹配自动导航；歧义匹配只展示候选并一次确认。
- stale-state、幂等、部分失败重试和成员票据权限均有 E2E 覆盖。

### F5：地图与导航细节

范围：

- 使用真实道路几何、编号 Marker、活动路段、当前位置和适配交通方式的路线样式。
- 统一下一站卡、地图 Canvas、选中地点 Sheet 和外部导航入口的数据来源。
- 完成重新定位、远距离用户位置不参与行程 fit bounds、路线重算和 Provider 降级。
- 地图缺少道路几何时明确标识估算或不可用，不把直线渲染为真实道路。

退出条件：

- 地图 Canvas 非空，Marker、路线、当前位置、控制区和地点 Sheet 无遮挡。
- 选中地点、切换日期、重定位和打开导航都有稳定 E2E。
- 动态地图不以像素完全相同为验收，而以真实数据、几何关系、可见区域和控件位置验收。

### F6：四个核心页面的富信息构图

按以下顺序实施，不同时重写全部页面：

1. 出发前今日：倒计时、唯一阻塞项、航班、住宿、保险、必要天气和单一主操作。
2. 旅行中今日：下一站照片、出发倒计时、交通、票据、导航和真实地图。
3. 行程：带媒体的连续时间线、交通连接、票据状态和日期切换。
4. 资料：真实票面/PDF 首页、对象元数据、分类、待确认状态和直接预览。

地点详情随后复用同一媒体、事实与票据组件；设置、费用、同行和 AI Draft 只做一致性修正，不扩张首轮范围。

退出条件：

- 四个页面在 `390x844` 具有与 Selected Target 相同的信息优先级、密度和视觉重心。
- 真实数据较少时页面自然收缩，不用说明文案或占位卡填满视口。
- 每个首屏只有一个主要动作；AI、搜索和更多操作继续按需出现。

### F7：视觉与交互精修

范围：

- 校准字体、字重、行高、间距、分割线、状态色、图标尺寸、媒体比例、裁切和对齐。
- 为媒体、事实和绑定增加稳定骨架、刷新、失败、过期、离线和空状态。
- 补齐页面切换、地点 Sheet、图片加载和状态变化的克制动效，并遵守 Reduced Motion。
- 保持触控目标至少 `44x44px`、主要按钮 `48px`、普通控件最大 `8px` 圆角。

退出条件：

- 浅色、深色、`200%` 文本、软件键盘和长内容状态均不重排到不可操作。
- 图片加载前后 CLS 小于 `0.1`；列表缩略图和 Hero 使用固定比例。
- 不新增卡片墙、装饰渐变、常驻 AI 文案或重复信息区。

### F8：面向设计图的严格验收

范围：

- 建立包含航班、酒店、保险、景点、餐厅、铁路、票据和实时事实的 `product-fidelity` 固定 fixture。
- Fixture 媒体必须是项目拥有、明确授权或仅限测试分发的可追踪资产，不从生成稿裁图冒充生产内容。
- 在同一 `390x844` 视口、同一状态、同一数据语义下并排比较 Selected Target 与真实实现。
- 保留固定代码基线 Golden 作为回归门禁，但不得再用“与历史代码一致”替代“与设计目标一致”。

验收规则：

- 静态布局、文字换行、控件尺寸、间距、层级和视觉重心逐项对照；所有 P0/P1/P2 差异必须关闭。
- Provider 控制的照片和地图像素不要求与生成稿内容相同，但媒体槽尺寸、裁切方式、叠层、路线语义和操作位置必须一致。
- 每个允许差异必须由真实数据、授权、无障碍或平台限制解释，不能再把缺少 Provider 或缺少字段长期列为“已批准视觉差异”。
- `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900` 全部通过无溢出、长内容、浅/深色、键盘和 `200%` 文本检查。
- iPhone Simulator Safari/主屏 PWA、Android Emulator Chrome/WebView 和 built-dist PWA 生命周期作为发布设备门槛；实体机仍为可选 Beta 观察。

## 6. 实施顺序与依赖

| 阶段 | 主要交付 | 依赖 | 风险 |
| --- | --- | --- | --- |
| P0 基线 | 固定 fidelity fixture、设计差异清单、媒体授权清单 | 无 | 低 |
| P1 媒体基础 | `TravelMediaAssetV1`、品牌注册表、mock adapter、共享组件 | P0 | 高，涉及远程媒体安全与授权 |
| P2 对象完整度 | 结构化字段、导入映射、统一 ViewModel | P0 | 中高，涉及数据合同 |
| P3 实时事实 | `RealtimeFactV1`、TTL、来源 UI、Provider mock/contract | P1/P2 | 高，涉及 Provider 与云端 |
| P4 联动 | 资料匹配、一次确认、票据直达 | P2 | 高，涉及票据权限与 AI 写入 |
| P5 地图 | 路线几何、位置、Marker、Sheet 和降级 | P3 可并行后半段 | 中高，涉及路线缓存合同 |
| P6 核心构图 | Today、Trip、Documents、Item Detail | P1-P5 的稳定 ViewModel | 中 |
| P7 精修 | Tokens、状态、动效、性能、无障碍 | P6 | 中 |
| P8 发布 | 设计对照、完整 E2E、模拟器、CI/部署 | P7 | 中 |

依赖原则：

- P1/P2 可用纯 mock 和本地 fixture 并行推进，但不能在 UI 中伪装成生产实时数据。
- P3 的 Provider 合同和 P1 的媒体代理必须独立 PR；不得与大面积页面样式变更混在一起。
- P4 必须复用 Action Gateway 的 schema、确认、幂等和 stale guard，不新建旁路写入。
- P6 只消费稳定 ViewModel，不在页面组件中直接解析 Provider payload、票据文件名或自由文本。

## 7. 页面验收矩阵

| 页面/状态 | 首屏必须存在 | 不得出现 |
| --- | --- | --- |
| 出发前今日 | 倒计时、唯一阻塞项、航班/住宿/保险真实对象、主操作 | 默认地图、大块建议、无来源天气 |
| 旅行中今日 | 下一站、倒计时、交通、票据、导航、真实地图 | 假地点照片、重复地址、叠加底部面板 |
| 行程 | 日期条、连续时间线、地点媒体、交通连接、票据状态 | 每个行程点厚卡片、重复添加入口 |
| 地图 | 道路几何、Marker、当前位置、活动路段、单一 Sheet | 截图地图、直线冒充道路、多 Sheet |
| 地点详情 | 真实照片或无图布局、时间、地址、导航、票据 | 渐变占位 Hero、Provider 诊断占首屏 |
| 资料 | 真实缩略图/PDF 首页、关键元数据、分类、待确认 | 文件类型头图替代可预览内容、双列卡片墙 |

## 8. 测试与质量门

### 单元与合同测试

- 媒体和品牌 schema、别名解析、来源、授权、TTL、尺寸与 MIME 校验。
- SSRF、重定向、超大响应、错误内容类型、未知 Provider 和恶意 URL 拒绝。
- 导入字段归一化、匹配置信度、歧义、重复对象和 stale-state。
- `RealtimeFact` 过期、刷新、部分失败、fallback 和无来源拒绝。
- ViewModel 在缺图、缺字段、长文本和过期事实下输出稳定。

### 组件与 E2E

- 从导入到对象生成、匹配预览、一次确认、Today/Timeline 展示和票据直达的完整流程。
- Provider disabled/mock/error/quota/kill-switch/offline 全路径。
- 地图 Canvas 像素非空、路线、Marker、位置、Sheet 和无遮挡。
- 图片/PDF/Logo 的 Loading、Error、Expired、Offline、Dark、Long name 状态。
- AI 不能注入媒体 URL、Logo、内部 ID 或未登记动作；写入保持一次最终确认。

### 性能预算

- 首屏 Hero 使用响应式变体，移动端单张目标不超过 `240 KiB`。
- 列表缩略图单张目标不超过 `80 KiB`，品牌 Logo 单个目标不超过 `20 KiB`。
- 首屏以下媒体延迟加载；Provider 图片和地图不得进入 PWA precache。
- 图片失败或切换尺寸不造成布局位移；新增媒体代码不得让入口超过现有 bundle budget。

### 发布检查

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`
- 相关 Provider、导入、票据、地图和页面 E2E
- `npm run test:e2e:serial`
- `npm run test:e2e:pwa-upgrade`
- 设计图同状态并排图、代码 Golden、无障碍和平台模拟器记录
- 推送后同 SHA GitHub required checks、Cloudflare 部署和受保护区域诊断

## 9. PR、灰度与回退

- 每个 P 阶段使用独立 `feature/` 或 `fix/` 分支；视觉 fixture 和规范可使用 `docs/` 分支。
- Provider、schema、存储、路线缓存、AI 隐私和票据权限改动必须经过 PR 与 required checks。
- 真实 Provider smoke 只有在当前任务明确授权后执行，每类 Provider 调用次数遵守项目上限。
- 新 Provider 与媒体类别使用服务端 feature flag、quota、budget 和 kill switch；关闭后回到文字与通用图标，不影响旅行主路径。
- 数据迁移先在 Supabase 预览分支验证 RLS、grants、constraints、advisors 和恢复路径。
- 回退只关闭新媒体/事实消费或恢复旧 ViewModel，不删除用户旅行、绑定、票据或实时事实历史。

## 10. 完成定义

全部满足后，本计划才可从 Target 改为 Current：

1. 八个工作流均有合并代码、测试、截图和阶段收据。
2. 四个核心页面使用真实媒体、结构化字段和有来源事实达到 Selected Target 的信息密度与视觉重心。
3. 景点/酒店照片、航司/铁路/保险品牌、天气、航班/铁路状态和路线 ETA 均有真实来源或明确降级。
4. 行程点、订单和资料可解释匹配，用户从 Today/Timeline 一次点击打开当前票据。
5. AI、Provider、媒体代理、票据权限、确认、幂等和 stale guard 无旁路。
6. 所有固定视口、长内容、浅/深色、键盘、Reduced Motion、`200%` 文本和横向溢出门槛通过。
7. 同状态设计对照没有未关闭的 P0/P1/P2 差异；允许差异逐项记录原因。
8. 本地全量验证、模拟器、同 SHA CI、Cloudflare 部署及必要 Supabase/Provider 诊断通过。

## 11. 首批可执行任务

1. 建立 `product-fidelity` fixture 与四个核心页面的设计差异台账。
2. 完成地点照片、酒店照片、航司 Logo、保险 Logo 的来源与授权决策记录。
3. 设计 `TravelMediaAssetV1`、`BrandIdentityV1` 和 `RealtimeFactV1` 的版本化 schema 与隐私审查。
4. 先用 mock adapter 实现媒体/品牌共享组件及失败降级，不触发真实 Provider。
5. 统一航班、住宿、保险、门票对象 ViewModel 和导入字段映射。
6. 扩展 Place、Weather、Flight/Rail Provider 合同与 mock；受限真实 smoke 后置。
7. 实现资料候选匹配、统一预览、一次确认和票据直达。
8. 完成路线几何、活动路段、当前位置和地点 Sheet 的地图精修。
9. 按出发前 Today、旅行中 Today、Trip、Documents 顺序完成页面构图。
10. 完成设计图直接对照、全量自动化、平台模拟器和远端发布收据。
