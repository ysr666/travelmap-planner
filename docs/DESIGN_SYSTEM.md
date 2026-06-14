# TripMap 设计系统基线

更新时间：2026-06-14

本文档是 Phase 15A 的设计系统基线。它描述当前 TripMap 应遵循的视觉、布局和交互规则，用于后续 Trip Home、Day View、Item Detail、Ticket Library、Settings 和 AI/provider 页面迭代。

## 产品气质

TripMap 是旅行现场控制台，不是营销页、内容杂志或订票平台。

- 页面第一屏应直接进入可用工作流：旅行、日程、地图、票据、设置或 AI 草稿，而不是 hero 营销介绍。
- 用户可见文案保持中文，语气短、明确、可执行。
- 视觉应接近 iOS / SwiftUI grouped list：安静、清楚、少装饰，强调可扫描信息和现场操作。
- 避免 AI 味：不要堆空壳 card、chip、渐变装饰、无意义分栏或解释性长文。

## 基础 Token

主要 token 位于 `src/index.css`。

- 主色：`primary` / `primary-container` 用于主要操作和当前状态。
- 辅助色：`secondary`、`tertiary`、`error` 只用于语义强调，不做大面积装饰。
- Surface：优先使用 `surface`、`surface-container`、`surface-container-high` 表达层级。
- 文本：标题使用 `font-headline-*`，正文使用 `font-body-*`，小标签使用 `font-label-sm`。
- 间距：页面横向使用 `px-4` / `--spacing-gutter`；section 间距使用 `gap-section-gap`；组内间距使用 `gap-stack-gap`。
- 焦点：可交互元素必须保留 `tm-focus` 或等效 focus-visible 样式。

## 页面结构

- App 页面应优先使用单列移动端布局，桌面只做适度 `max-w-*` 约束，不扩成复杂仪表盘。
- 390px 宽度是基础验收线。按钮文字、标题、chip、卡片内容不能横向溢出。
- 内容区使用自然 section，不把页面 section 整体做成漂浮 card。
- Card 只用于单个重复对象、分组列表容器、工具面板、弹窗和需要明确边界的局部模块。
- 禁止 card 套 card。需要层级时用 row、separator、surface tint 或 section header。
- 不使用装饰性 orb、bokeh、抽象 SVG 背景或一屏大渐变作为功能页面主视觉。

## Grouped List

首选模式：

- `GroupedSection` + `ListRow` 用于设置、菜单、摘要和可点击列表。
- Section header 使用 12-13px uppercase / tracking-wider / muted 文本。
- Row 最小高度 56px，左侧 icon 40px，右侧 chevron 只用于可进入下一层的操作。
- Row detail 最多两行，长文本使用 `line-clamp` 或 `break-words`，不要撑开布局。
- 分隔线从内容列开始，不贯穿 icon 区。

避免：

- 为每一行再包一张 card。
- 用 chip 代替真实字段。
- 用长段说明解释按钮用途。

## Buttons And Controls

基础组件：`src/components/ui/Button.tsx`。

- Primary：页面主提交、确认应用、进入核心任务。
- Secondary：同级次要操作、打开工具、外部导航。
- Ghost / subtle：局部轻操作、展开、辅助命令。
- Destructive：删除、清理、撤销不可恢复操作。
- 图标按钮优先使用 lucide icon 和 `aria-label`，不要用文字胶囊替代熟悉图标。
- 触控目标最小 44px，常用按钮当前基线是 `min-h-12`。
- Loading button 必须禁用重复提交，并显示 spinner。

## Forms

- 新建 / 编辑 Trip 和 Item 使用独立页面，不放进小弹窗。
- 表单字段使用 `FormField`、`TimeZoneSelect` 和本地 select 控件。
- 日期保持 `YYYY-MM-DD`，时间保持 `HH:mm`，timezone 使用 IANA ID。
- 错误提示在提交按钮上方或相关字段下方，文字要说明用户下一步怎么改。
- 移动端键盘场景下，底部按钮不能遮住当前输入。
- 复杂可选字段先折叠或按条件显示，例如跨时区字段只在 long-distance transport 或已有 timezone 字段时展开。

## Sheets And Dialogs

- Bottom sheet 用于短任务、更多菜单和确认局部选择。
- 长表单、跨页面编辑、导入流程不放 bottom sheet。
- Sheet 必须有明确 title 或 aria label，并通过 `useModalAccessibility` 保持焦点和 Escape 关闭。
- ConfirmDialog 只用于需要二次确认的写入边界，例如删除、AI apply、路线顺序应用、云端覆盖。

## Maps

- Day View 地图是现场工作面，应尽量 full-screen 或 embedded full-height，不放进装饰 preview card。
- Marker 交互目标：点击 marker 显示轻量 item card；点击 card action 进入 Item Detail。
- 地图浮层只保留必要控制：返回、视图切换、日期选择、回到行程范围、当前位置、轻量通知。
- 不恢复旧 bottom sheet、route chip 堆叠或 route controls section 到 Day View map。
- 地图失败时展示本地行程仍可用的 fallback，不让用户误以为数据丢失。
- 不缓存商业地图瓦片，不改 service worker 做瓦片离线缓存。

## Trip Home

- Trip Home 是旅行级总览，不是 Day View 的重复版。
- 首屏应包含旅行标题、日期、地图概览、今日/当前 Day 入口、票据和准备度/操作建议入口。
- 地图概览按已有 Day 顺序和坐标展示，不在 timezone 模型不足时新增隐式“当前旅行日”推断。
- 主要入口应少而清楚：进入日视图、票据库、路线/准备度/AI 修改建议。

## Day View

- Schedule 和 Map 是同一 Day 的两种工作面。
- Schedule 负责当天列表、时间线、现场操作和 item 进入。
- Map 负责地点空间关系、marker-card、当前位置和回到行程范围。
- View switch、day selector 和返回行为要在 schedule / map 间保持 URL 可恢复。

## Item Detail

- Item Detail 是旅行现场查看页。
- 信息优先级：标题、时间、地点、外部导航、票据、交通、备注、内容补充。
- 票据展示应紧凑，可横向预览，不把现场票据藏到长列表底部。
- 外部导航只在坐标有效时显示；无坐标时提示先补坐标。
- 从地图进入时，底部主按钮应返回地图；从日程进入时返回日程。

## Ticket Library

- 当前 Ticket Library 仍偏文件列表，后续 2.0 目标是票据画廊。
- Gallery item 应展示票据标题、类型、绑定对象、storage mode 和 preview affordance。
- Copy / reference / external 三模式必须可区分，但不要用大段解释淹没列表。
- 票据预览应支持全屏查看、切换同组票据和回到绑定 item。

## AI And Provider Surfaces

- AI 写入保持 preview + final confirmation。
- Search 必须 source-bearing，没有来源不声明实时营业时间、票价、闭馆、交通中断、近期评价或活动。
- Provider key、quota、proxy 状态只在设置/开发面板中低调呈现，不进入普通旅行页面。
- AI 和 provider 错误提示不得包含 key、key prefix、raw provider body、prompt、Authorization、Bearer 或 stack trace。
- AI 结果用于辅助整理，不替代用户确认。

## Visual QA Checklist

每个 UI phase 至少检查：

- 390px mobile 没有横向滚动、按钮文字挤压或浮层遮挡。
- 页面主流程第一屏可用，不是说明页。
- Section 没有 card 套 card。
- 表单错误、loading、empty、permission denied、provider unavailable 都有状态。
- 图标按钮有 `aria-label`，常用控件有稳定 test id 或 scoped locator。
- 地图和大型异步区域有 loading/fallback，不出现空白黑块。
- 暗色模式文本对比可读。
- User-facing copy 是中文。
