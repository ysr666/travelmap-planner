# UI V3 产品质感基线与差异台账

更新时间：2026-08-10

状态：**Visual Current；P0-P8 visual baseline verified，无未关闭 Visual P0/P1/P2；产品内容接入仍为 Partial**

上游合同：[UI V3 产品质感增强实施计划](UI_V3_PRODUCT_FIDELITY_PLAN.md)

产品级后续合同：[完整产品级交付计划](PRODUCT_GRADE_DELIVERY_PLAN.md)

## 1. 参考与复现合同

Selected Target 是 2026-08-04 确认的四屏组合稿：出发前今日、旅行中今日、行程、资料。原始设计输入保存在本机 Codex 生成资产目录：

`/Users/ysradmin/.codex/generated_images/019f408f-a034-7262-a9d4-36f429207ee6/exec-084f9e07-16d8-463e-99ac-fc66c2aca5ae.png`

- 原图：`853 x 1844`，SHA-256 `fd5b2f676edd58c1d60d6ded24e573fb054c24f53ec2dcac1c36da6a3f34aabe`。
- 对照视口：每个实现页面固定为 `390 x 844`；设计图按四象限裁切后等比缩放，不拉伸。
- 对照数据：只使用 `e2e/fixtures/product-fidelity-v1.json`，不使用随机、当前账号或实时 Provider 数据。
- 动态地图不做底图像素比较；校验道路几何、活动路段、Marker、当前位置、可见范围、控件与单一 Sheet。
- 照片内容不要求复刻生成稿，但必须对应同一真实对象，且媒体槽比例、视觉重心、裁切和信息叠层一致。

严重级别：

- **Visual P0**：改变首屏任务、对象真实性、主操作、固定层关系或造成溢出的发布阻断项。
- **Visual P1**：明显破坏信息密度、视觉重心、对象识别或跨屏一致性的主要差异。
- **Visual P2**：字重、间距、分割线、图标、裁切、状态和动效等精修差异。

状态只允许 `open | implemented | verified | accepted-platform-difference`。缺少 Provider、字段或素材不能长期标记为允许差异。

## 2. 全局差异

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| G-01 | P0 | 四项底栏固定为“今日、行程、资料、我的”，AI 只在右上按需打开 | 已实现四项底栏和按需 AI | P6 | verified |
| G-02 | P0 | AI、地图地点 Sheet、sticky action 与底栏不叠加 | 浏览器与 Android WebView 软件键盘实测均只显示一个展开底部交互层；地图保持单一地点 Sheet | P6/P8 | verified |
| G-03 | P1 | 信息密度来自真实对象、品牌、图片和结构化字段 | 四个核心页面已统一消费旅行对象、受控媒体、品牌和结构化字段 | P1/P2/P6 | verified |
| G-04 | P1 | 页面是无框分组、行、分隔线与少量独立记录 | Today 与时间轴使用无框分组和分隔线；资料仅为独立文档记录保留边界，五屏重拍无卡片墙 | P6/P7 | verified |
| G-05 | P1 | 顶栏、标题、日期条、内容和底栏在四屏具有统一节奏 | 五个核心构图已按同一 `390x844` fixture 重拍并完成视觉复核 | P6/P7 | verified |
| G-06 | P2 | 所有图像在加载、失败、离线和切换尺寸时保持稳定比例 | 图片仅在真实 `load` 后进入 ready；loading/error/offline/reduced-data 前后尺寸稳定且 CLS 小于 `0.1` | P1/P7 | verified |
| G-07 | P2 | `320px`、长中文/英文、无空格文件名与 `200%` 文本无横向溢出 | 五个固定视口及 `320px + 200%` 长中文/无空格英文状态均无横向溢出，操作保持可达 | P7/P8 | verified |

## 3. 出发前今日

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| U-01 | P0 | 首屏先显示“上海 → 伦敦”、出发日期与 8 天倒计时 | 已由结构化航段显示“上海 → 伦敦”、出发日期和倒计时；机场代码留在航班对象行 | P2/P6 | verified |
| U-02 | P0 | 只有一个简短阻塞条与“一键补全”主动作 | 单一阻塞条继续直达 Action Gateway 一键补全，准备对象不重复解释 | P4/P6 | verified |
| U-03 | P0 | 航班行显示 Air China 品牌、CA849、出票状态、日期、两地时间、机场和航站楼 | 已从航段 ViewModel 显示品牌、航班号、状态、日期时间和机场；详细航站楼保留在对象字段 | P1/P2/P3/P6 | verified |
| U-04 | P1 | 酒店行显示真实缩略图、名称、入住/退房、晚数和地址 | 已显示受控酒店照片、名称、入住/退房、晚数和确认号 | P1/P2/P6 | verified |
| U-05 | P1 | 保险行显示 Allianz 品牌、产品、有效期、保单号和生效状态 | 已显示 Allianz 品牌、产品、有效期、保单号和保障状态 | P1/P2/P6 | verified |
| U-06 | P1 | 只显示一条影响准备的天气事实与短建议 | 已显示一条带来源和新鲜度的天气事实与短建议，无事实时隐藏 | P3/P6 | verified |
| U-07 | P2 | 三个对象行保持一致的 72-96px 节奏、细边框和清晰元数据层级 | 三类对象使用统一 72px 行、细分隔线和三级元数据，并通过五视口与 200% 文本回归 | P6/P7 | verified |
| U-08 | P2 | 首屏底部只有“查看全部行程”一个主要按钮 | 已实现 | P6 | verified |

## 4. 旅行中今日

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A-01 | P0 | 下一站 Hero 同时显示爱丁堡城堡真实照片、日期/城市、出发倒计时、交通、入场时间和票据状态 | 已由同一对象模型显示真实照片、日期/城市、倒计时、交通和精确票据 | P1/P2/P3/P6 | verified |
| A-02 | P0 | Hero 内唯一主动作是“开始导航” | Hero 仅保留一个满宽“开始导航”主动作，票据为次级直达动作 | P6/P7 | verified |
| A-03 | P0 | 地图使用真实道路几何、编号 Marker、活动路段和当前位置 | 已用缓存道路几何、交通模式活动路段、编号 Marker、当前位置与诚实降级状态通过真实画布 E2E | P5/P6 | verified |
| A-04 | P0 | 地图下方只有当前地点 Sheet；票据按钮一次点击打开正确票面 | 单一地点 Sheet 已按当前行程点显示交通与票据数量；唯一票据直接打开，宽泛目标进入作用域画廊 | P4/P5/P8 | verified |
| A-05 | P1 | Hero 与地图形成首屏主视觉，不插入建议卡或常驻 AI 文案 | 有媒体时 Hero 与地图连续构成首屏；无媒体时自然回退文字布局 | P6 | verified |
| A-06 | P2 | Hero 照片不压暗到不可检查，文字叠层满足对比度且保留主体焦点 | 照片保持原亮度并使用独立文字区和焦点裁切；浅/深色严重与关键 Axe 检查通过 | P1/P7 | verified |
| A-07 | P2 | 地图控件、Sheet、底栏和安全区无重叠 | 路线状态、定位、日期条和单一地点 Sheet 已在 `320x568` 至 `1440x900` 五个视口通过边界与无溢出校验 | P5/P8 | verified |

## 5. 行程

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T-01 | P0 | 顶部日期条紧凑，当前日突出；时间线立即开始 | 日期条、视图切换和连续时间线已在首屏形成明确层级 | P6/P7 | verified |
| T-02 | P0 | 每个地点行展示对象对应的真实缩略图、时间、地点、地址/区域、交通连接和票据状态 | 地点与铁路行已显示对应媒体、时间、地点、交通连接和票据状态 | P1/P2/P4/P6 | verified |
| T-03 | P0 | 时间线连续，交通连接是轻量行，不把每个地点做成厚卡片 | 当前连续线与轻量交通已实现 | P6 | verified |
| T-04 | P1 | 大英博物馆、Dishoom、塔桥与 LNER 列车一眼可识别 | 四类对象均使用对应受控照片并保持标题可辨识 | P1/P6 | verified |
| T-05 | P1 | 火车行显示起终站、约 4h30m、座位和已就绪车票 | 火车媒体行与连接行显示起终站、270 分钟、LNER、座位和票据状态 | P2/P4/P6 | verified |
| T-06 | P2 | 缩略图为固定 `4:3`，长标题与英文地址仍保留操作列 | 固定媒体尺寸、两行标题和独立 44px 操作列已在五视口、长文本与 200% 状态验证 | P1/P7 | verified |
| T-07 | P2 | 排序、编辑、删除等低频操作隐藏在工具栏或更多菜单 | 当前已基本实现 | P6 | verified |

## 6. 资料

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D-01 | P0 | 资料首页是编辑式单列列表，左侧真实票面/PDF 首页缩略图 | 可用票面/PDF/受控媒体优先展示；无票面但可识别品牌的对象显示品牌，最后才降级文件类型 | P1/P6/P7 | verified |
| D-02 | P0 | 每行显示名称、分类、日期和一项关键字段；点击直接打开 | 已由统一 ViewModel 显示名称、分类、日期/时间、关联状态，并保留直接预览 | P2/P4/P6 | verified |
| D-03 | P0 | 待确认数量是筛选状态，不占据大块说明区 | 关联状态保持在行与紧凑筛选中，不新增说明面板 | P4/P6 | verified |
| D-04 | P1 | 门票、保险、火车票、酒店分别具有真实而不同的视觉预览 | 门票/酒店/铁路使用真实媒体，航司/保险使用受控品牌；缺失时稳定降级 | P1/P2/P6/P7 | verified |
| D-05 | P1 | 分类筛选紧凑、单选明确，搜索和 AI 是工具命令 | 当前 IA 已符合，新增类别和状态需保持 | P6 | verified |
| D-06 | P2 | 缩略图、标题和更多按钮在 320px 与长文件名下不挤压/溢出 | 产品 fixture 的长标题与无空格文件名在 `320px + 200%` 下无溢出，44px 更多操作保持可见 | P7/P8 | verified |

## 7. 地点详情与共享组件

| ID | 级别 | Selected Target | 当前实现 | 责任阶段 | 状态 |
| --- | --- | --- | --- | --- | --- |
| I-01 | P0 | 地点详情复用真实地点媒体、营业/天气事实、地址、导航和关联票据 | 已复用同一对象媒体、未过期来源事实、地址、导航和精确票据；无来源事实不显示为当前状态 | P1/P2/P3/P4/P6/P7 | verified |
| I-02 | P0 | 查找地点成功返回真实候选；无效、歧义、quota 和 Provider disabled 都有短错误且不写入 | mock Provider 成功候选只在最终确认后写入；disabled、invalid、quota、歧义均显示短错误并保持零写入 | P3/P8 | verified |
| I-03 | P1 | 同一个旅行对象在 Today、Timeline、Documents 和 Detail 使用一致标题、品牌、媒体和状态 | 五个页面已消费同一版本化旅行对象集合与共享呈现组件 | P2/P6 | verified |
| I-04 | P2 | 所有媒体支持 loading/error/expired/offline/reduced-data，且不改变布局尺寸 | 五种状态均由共享组件覆盖；离线/省流不请求 Provider，恢复联网后可重试，布局尺寸稳定 | P1/P7 | verified |

## 8. 允许差异

只有下列差异可以在最终台账中保留，并必须进入 `accepted-platform-difference`：

1. iOS Safari、Android Chrome 与桌面浏览器的系统字体栅格、原生安全区和滚动条像素差异。
2. 动态地图底图瓦片、POI 标签、实时交通和用户位置精度差异；道路几何与交互语义不能缺失。
3. Provider 返回的同一真实对象照片可以不同于生成稿；不得用不相关图片填槽。
4. 品牌没有合法可用资源或无法从结构化代码可靠识别时，使用通用 Lucide 图标加名称；不得猜 Logo。
5. 无来源或已过期的实时事实完全隐藏或显示简短过期状态；不得为了贴图保留生成稿中的天气/状态。
6. `200%` 文本下允许卡片/行纵向增长和次要字段换行，不允许横向滚动、遮挡或操作消失。

## 9. P0 退出收据

- 固定素材清单：`e2e/assets/product-fidelity/assets.json`。
- 素材权利与署名：`e2e/assets/product-fidelity/LICENSES.md`。
- 固定旅行对象：`e2e/fixtures/product-fidelity-v1.json`。
- 设计差异：本文件；所有 Visual P0/P1/P2 项已关闭为 `verified`，没有用缺失 Provider、字段或素材换取允许差异。
- P8 的本地、浏览器、模拟器与远端发布验收均已完成；发布收据记录在 `design-qa.md` 与阶段台账中。

## 10. P8 设计与设备收据

同状态并排图（本机运行产物，不提交仓库）：

- `output/playwright/product-fidelity-design-qa/today-predeparture-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/today-active-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/itinerary-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/documents-side-by-side.png`

允许差异的实际使用：

- 地图底图、POI 标签和照片像素使用真实运行结果，不复制生成稿；路线几何、选中状态、媒体比例、裁切、信息层级和操作位置已校准。
- iOS 与 Android 保留系统字体栅格、安全区和键盘差异；两端都没有横向滚动、不可达主操作或可见固定层叠加。
- 无合法品牌资源或无来源实时事实时使用受控图标或隐藏事实，不用假 Logo、假天气和假状态补图。

设备证据：

- iPhone 16 / iOS 26.5 Simulator：Safari、安装到主屏、独立 PWA 启动和全高 App Shell 通过。
- Android API 33 Emulator：Chrome/WebView、真实地图 Canvas、道路/Marker、单一地点 Sheet、资料、我的、AI Action Sheet 和软件键盘通过；可访问性树中的导航、对话框、文本框和操作按钮均有名称。
- Android WebView 103 在修复前把 `#root`/`.app-viewport` 压缩为内容高度；修复后可见视口、根节点、App Shell 与底栏底边一致，`scrollWidth === clientWidth === 411`。
