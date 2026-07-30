# TripMap UI V3 Design

更新时间：2026-07-30

状态：**Selected Target**

规范来源：[UI V3 重构规范](UI_REFACTOR_V3.md)

## 1. 选定方向

用户已确认采用 `2+3 融合稿`：

- 保留方案 2 的视觉语言：白色主表面、克制青绿、清晰中文层级、紧凑线性图标、充足留白、真实旅行对象、明确现场主操作。
- 采用方案 3 的信息层级：地图是旅行中“今日”页面的第一内容，当前位置、路线、编号地点和下一站在打开页面后立即可见。
- 下一站、门票和导航收敛到地图上的唯一 Bottom Sheet；稍后行程只作紧凑预览。
- 四项主导航稳定为 `今日 | 行程 | 收件箱 | 我的`；AI 是顶栏命令，搜索是上下文命令。

生成式参考为 2026-07-30 展示的融合图。生成图不提交仓库，也不负责精确文案、地图瓦片、实时状态或组件边界；真实 React 组件和通过验收的 Golden Screenshots 最终取代它。

## 2. 产品感觉

TripMap V3 应该像一款安静、可信、现场可用的原生旅行工具：

- 打开即定位，不先阅读产品说明。
- 真实地点、路线、时间和票据先于统计、建议和设置。
- 一个屏幕只突出一个当前动作。
- 层级主要靠间距、字体、对齐和分隔线，不靠厚重卡片。
- 青绿表示主操作和选中状态；珊瑚红只用于少量提醒或危险动作。
- 技术状态转译为用户任务语言，默认不暴露 Provider、配额、缓存、schema 或诊断。

禁止宣传 Hero、大块建议、重复摘要、渐变地点头图、嵌套卡片、装饰阴影、常驻 AI 输入框、五项以上底栏和页面私有固定底栏。

## 3. 视觉系统

### 字体

使用系统字体：

```css
-apple-system,
BlinkMacSystemFont,
"SF Pro Text",
"PingFang SC",
"Microsoft YaHei",
"Segoe UI",
sans-serif
```

不加载新的 Web Font。数字时间使用 tabular numbers。`letter-spacing: 0`。

### 类型

| 角色 | 字号 / 行高 | 字重 |
| --- | --- | --- |
| Page title | `20 / 28` | `600` |
| Object title | `24 / 32` | `650` |
| Section | `17 / 24` | `600` |
| Body | `15 / 22` | `400` |
| Meta | `13 / 18` | `400–500` |
| Navigation label | `11 / 16` | `600` |

移动端不使用超过 `28px` 的宣传式标题。长名称在列表最多两行，在详情完整展示。

### 颜色

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `background` | `#F7F9F8` | `#0E1413` | 页面 |
| `surface` | `#FFFFFF` | `#151D1B` | Sheet、Dialog、独立对象 |
| `surface-subtle` | `#EFF4F2` | `#1C2825` | 轻分组与选中背景 |
| `text` | `#15201E` | `#F3F7F6` | 主文字 |
| `text-muted` | `#5E6B68` | `#A9B7B3` | 次文字 |
| `border` | `#DDE5E2` | `#34423E` | 分隔 |
| `primary` | `#0E7C73` | `#72D3C8` | 主操作、路线、选中 |
| `primary-strong` | `#08645D` | `#95E2D9` | pressed、强调时间 |
| `secondary` | `#D05A47` | `#FF9D8D` | 少量影响提醒 |
| `success` | `#18794E` | `#6FD19A` | 已就绪 |
| `warning` | `#9A5B00` | `#F1C46B` | 需关注 |
| `danger` | `#B42318` | `#FF8B82` | 删除、阻塞 |

地图路线、Marker 和选中状态使用同一 `primary` 家族；普通页面不能扩展为单一青绿色调。

### 间距、形状与层级

- 基础间距：`4 | 8 | 12 | 16 | 24 | 32`。
- 手机水平边距 `16px`；地图、媒体和全屏 Canvas 可以贴边。
- 普通控件最大圆角 `8px`；Bottom Sheet 顶部圆角 `12px`。
- 普通页面无阴影；Modal / Sheet 只有一级克制 elevation。
- 行高和控件高度固定，Loading、长文本和选中状态不能改变布局尺寸。
- 触控目标至少 `44 x 44px`；主要按钮高度 `48px`。

### 图标与媒体

- 继续使用项目已安装的 Lucide 线性图标，统一 `1.75–2px` 描边。
- 熟悉命令使用图标；图标按钮必须有可访问名称和 Tooltip。
- 地图使用真实 MapLibre/Provider 输出或稳定 fixture，不用截图伪装可交互地图。
- 地点只有真实且可检查照片时显示图片。
- 票据使用真实图片、二维码或 PDF 首页缩略图，绝不使用文件类型头图替代可预览内容。

## 4. App Shell

### 移动端

- 顶栏高度 `56px + env(safe-area-inset-top)`。
- 左侧为返回或紧凑旅行切换；中间只有一个页面标题；右侧最多两个命令。
- AI 使用 `Sparkles` 图标和可访问名称“AI 助手”。
- 底部主导航高度 `56px + env(safe-area-inset-bottom)`，固定四项。
- 页面内容 inset 只由 `AppScaffold` 计算。
- 同一时刻只允许主导航、Modal Sheet 或地图地点 Sheet 中的一个成为固定底部交互面。

### 平板

- `600–1023px` 使用 `72px` Navigation Rail。
- 日程/详情、资料/预览可以双栏；AI 使用右侧 `420px` Dialog。

### 桌面

- `>=1024px` 使用 `240px` Sidebar 和列表/详情主从布局。
- 主内容占满可用 Canvas，不显示居中窄手机长条。
- 最大阅读行宽只约束正文和表单，不约束地图、时间线或画廊。

## 5. 核心组件合同

### `AppScaffold`

唯一管理安全区、顶栏、主导航、Modal、z-index 和内容 inset。页面不得直接使用猜测式 `pb-32`、`pb-48` 或第二套固定底栏。

### `ContextHeader`

包含返回、唯一标题和最多两个命令。Search、AI、Add 和 More 依据页面上下文出现；技术入口不占主工具栏。

### `PrimaryNavigation`

同一组件渲染 Tab Bar、Rail 和 Sidebar。顶层映射：

- `今日`：Home/Today。
- `行程`：Trip、Day、Map、Item、Ticket、Document、Ledger 和 Shared Trip。
- `收件箱`：Inbox。
- `我的`：Settings 及其二级页面。

Search 与 AI Draft 通过来源上下文返回，不获得独立 Tab。

### `MapCanvas`

全幅地图，保留当前位置、路线、Marker、缩放和无障碍替代列表。Map Canvas 与 Sheet 共享可用高度，控件不被顶栏、Sheet 或安全区遮挡。

### `TripStopSheet`

只显示当前选中地点。半展开状态包含日期/城市、下一站、出发时间、步行时长、关联票据和一个“开始导航”主操作；稍后行程最多预览两项。完整列表通过“查看全天行程”进入日程。

### `AiActionSheet`

关闭时不挂载可见输入或占位。打开后显示上下文、输入、短计划、一个主操作和折叠步骤。只读动作可直接完成并关闭；写入必须真实预览和一次最终确认。

### `TimelineRow`

使用稳定时间列、轴线、名称、地点和必要状态。编辑、删除和重排进入 More 或等价非拖拽操作。

### `DocumentThumbnail`

固定 `3:4`，票面优先 `contain`。支持 Loading、Error、Selected 和 Long name，不改变网格轨道。

### `DisclosureRow` / `FormSection`

设置一级和高级表单默认收起。首屏只展开用户完成当前任务所需字段。

## 6. 六个关键屏幕

### 今日

- 地图占首屏主要面积，立即显示当前位置、当天路线和编号地点。
- 唯一地点 Sheet 默认聚焦下一站。
- 下一站名称、出发时间、步行时长、票据和导航在一次扫读中完成。
- 只有一项有来源且影响当前行程的提醒可以出现在 Sheet 后续区域。
- 出发前阶段可以降低地图高度并提高准备完成度；仍不能恢复大块建议。

### 日程

- 顶部为紧凑日期条和 `日程 | 地图 | 资料 | 费用` 上下文切换。
- 主体为连续时间轴；每个地点不包成独立厚卡片。
- 点击地点 Push 到详情；编辑、移动和删除进入上下文菜单。

### 地图

- 全屏 Map Canvas；顶部只留返回、日期/模式和 More。
- 选中地点后使用同一 `TripStopSheet`，未选中时 Sheet 收起到紧凑把手或完全隐藏。
- AI Sheet 打开前先收起地点 Sheet，关闭后恢复选择。

### 地点详情

- 无真实照片时直接从名称、时间和地址开始。
- 首屏提供开始导航和打开关联票据。
- 地点信息、票据、备注和更多依次排列；Provider 诊断进入二级页面。
- 移动端长票据名称和地址必须 `min-width: 0`、可换行且不横向溢出。

### 票据与资料

- 首屏直接进入真实缩略图画廊。
- 添加在顶栏；筛选、排序和批量选择进入 Sheet。
- 分类只有一行，零数量隐藏；空状态只有一个导入主操作。
- 点击缩略图打开原票据；AI 查找精确命中时导航到同一详情并关闭 AI。

### AI Action Sheet

- 移动端最高 `72dvh`，输入法打开时关闭、输入和主操作仍可见。
- 一句摘要、步骤数、影响对象和一个主按钮；详情默认折叠。
- 部分失败只显示完成/失败数量和“重试失败项”。
- Dialog 焦点陷阱、Escape、焦点返回和 `aria-live` 必须通过自动化。

## 7. 其余页面

- 收件箱直接显示资料列表或单一导入空状态；来源配置进入二级页面。
- 设置一级固定四组，技术项进入“数据与高级”。
- 编辑表单默认只展开基本信息和地点，高级字段进入“更多设置”。
- 费用、Shared Trip、AI Draft 等复用 `Section`、`RecordRow`、`DisclosureRow` 和同一 Shell。
- 全局搜索是顶栏/内容命令，结果按旅行对象分组，不再是底栏入口。

## 8. 状态与行为

- Loading 使用同结构 Skeleton。
- Empty 为一句原因和一个主操作。
- Offline / Stale / Provider failure 只在影响当前任务时显示一行可恢复状态。
- 长内容覆盖中文、英文、无空格文件名、地址和票据名称。
- 所有写入继续由 Action Gateway 真实预览、一次确认、状态指纹、幂等和失败重试保护。
- 所有页面支持 Light/Dark、`200%` 文本、键盘、Reduced Motion 和安全区。

## 9. 实现允许与禁止

允许：

- 为展示层拆分 ViewModel、共享组件和自适应布局。
- 调整 Hash Route 的视觉映射，保留原 URL 和深链接兼容。
- 用稳定 fixture 对地图、缩略图和实时状态进行视觉测试。

禁止：

- 借 UI 重构改变数据库 schema、云端覆盖语义、Provider 合同、AI 隐私、票据 Blob、路线缓存或风险确认。
- 把 Stitch、ImageGen 或 Figma 代码直接合并到生产。
- 用硬编码效果图数据替代真实业务状态。
- 用 CSS 图形、手写 SVG、Emoji 或占位图片模拟可用资产。

## 10. 验收

选定效果图只作为方向参考。实现必须满足：

- `UI_REFACTOR_V3.md` 的固定视口、固定状态、点击数、无障碍、性能和实体机矩阵。
- `390 x 844` 同状态截图与融合稿具有相同的信息层级、密度、色彩和空间重心。
- 动态地图通过 Canvas 像素、Marker、路线、控件和遮挡结构验证。
- 每个核心页面 `scrollWidth <= clientWidth`。
- Golden Screenshot、axe、typecheck、lint、单测、build、相关 E2E、全量串行 E2E 和 PWA 升级测试通过。
- 发布前在真实 iPhone Safari/PWA 与 Android Chrome/PWA 记录结果。

## 11. Stitch 设计追踪

Stitch 只用于同一 Design System 下的跨屏一致性校验，不是代码或产品状态真相源。

| 项目 | 标识 |
| --- | --- |
| Stitch Project | `9253865158827971218` |
| Design System | `4831380021779748496` |
| Today | `62d6e0501e4546efb285fe9d2fb1e052` |
| Itinerary | `cd0f24c700eb4f63b6675faf5d0a9804` |
| Map | `de4b0307aafb4308accb6b5b09f44ce0` |
| Place Detail | `eb48db24108e440cb3aaf22631aca6be` |
| Documents | `f87e2e37f99c499eaf7c629e03d13543` |
| AI Action Sheet | `0c8b97fdade94b1f8558e9204d5a4167` |

Stitch 生成时提出的深蓝主色、默认展开 AI 步骤、额外天气组件等建议不属于选定方案。只有具备来源且影响当前行程的天气提醒可以作为紧凑状态出现；不得改变 `primary`、渐进披露或首屏密度合同。
