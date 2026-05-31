# 设计系统对齐 - 完整改动报告

## 项目概述
旅图 TripMap - 本地优先 PWA，React 19 + TypeScript + Tailwind CSS 4
分支：`feature/swiftui-design-system-pass-1`

## 参考设计文件
所有参考设计在 `/Users/ysradmin/Downloads/stitch_tripmap_ios_ui_system/`：
- `_1/` → ItemDetailPage (dark)
- `_2/` → SettingsPage (dark)
- `_3/` → HomePage (dark)
- `_4/` → ItemDetailPage 变体 (light)
- `_5/` → SettingsPage 变体 (light)
- `_6/` → HomePage 变体 (dark)
- `12_1/` → TripWorkspacePage (dark)
- `12_2/` → DayViewPage (dark map)
- `12_3/` → DayViewPage (light list)
- `12_4/` → TripWorkspacePage (light)

---

## Pass 1: Token 体系 + 基础组件

### A. Design Token 补全
- 补全 19 个 MD3 颜色 token（on-primary-container, on-secondary, inverse-surface 等）
- 引入 Inter 字体，修正 font-body 从 Plus Jakarta Sans → Inter
- 添加 6 个字体族 token（headline-md, body-md, headline-lg-mobile, body-lg, headline-lg, label-sm）
- 添加 6 个字号 token（`--text-headline-md: 22px` 等，注意 Tailwind v4 用 `--text-*` 不是 `--text-*--size`）
- 添加 5 个间距 token（gutter, margin-desktop, stack-gap, section-gap, margin-mobile）
- 修正背景色：`#eef3f8` → `#f8f9fb`
- 添加毛玻璃效果 token

### B. 组件样式对齐
- Card：改用 `bg-surface-container border-outline-variant/30`
- ListRow：图标 `size-10 rounded-full`，分隔线 `left-[60px]`
- SectionHeader：`font-label-sm text-label-sm uppercase tracking-wider`
- Button：`text-[15px]`，`min-h-12`，暗色 `bg-primary text-slate-950`
- BottomTabBar：`h-16`，`text-[13px]`，`max-w-[600px]`

### C. 全局样式
- 261 处 `text/bg/ring/border-slate-*` 替换为 MD3 token
- `.tm-*` CSS 类改用 CSS 变量
- `.dark` 手动覆盖从 33 行减至 2 行

---

## Pass 2: 页面级重写

### HomePage (基于 `_3/code.html`)
- TopAppBar：`fixed top-0 bg-surface/70 backdrop-blur-xl h-16` + Map 图标 + "旅图" font-bold + Settings 按钮
- Hero 区：`font-headline-lg-mobile` 标题 + `font-body-md` 副标题 + Settings 按钮
- Hero 卡片：`bg-surface-container rounded-xl border-outline-variant/30` + `p-6` + `grid-cols-3` 统计
- 列表：`w-12 h-12 rounded-lg` 缩略图 + `font-body-lg` 标题 + `border-b` 分隔线 + ChevronRight
- 底部按钮：`bg-[#0A84FF] text-white` + `bg-[#2C2C2E] text-[#0A84FF]`

### ItemDetailPage (基于 `_1/code.html`)
- Header：`fixed top-0 bg-surface/70 h-16` + 返回 + "详情" font-bold + 编辑按钮
- Hero：`h-[320px]` + 渐变 + `font-headline-lg-mobile` 标题 + 时间/地点胶囊
- 基础信息 section：地点/时间/备注三行 `w-10 h-10 rounded-full` 图标 + `p-4` + `border-b`
- 交通 section：独立区域 + 导航链接
- 票据 section：水平滚动 `ticket-cutout` 卡片 + 虚线分隔
- 底部栏：三按钮（上一项/返回地图/下一项）`fixed bottom-0`

### SettingsPage (基于 `_2/code.html`)
- 完全重写为二级菜单结构
- 4 个 section：账户与云端、AI与隐私、地图与路线、外观
- SettingsSection/SettingsRow/SettingsToggleRow 组件
- 每行：`w-8 h-8 rounded-full` 图标 + `font-body-lg` 标题 + ChevronRight
- 分隔线：`h-[1px] ml-[60px] bg-outline-variant/30`
- 退出登录：纯红色文字按钮
- 实际功能接入：暗色模式切换、云登录状态、隐私 toggle

### TripWorkspacePage (基于 `12_1/code.html`)
- 今日概览 section：`font-headline-md` 标题 + 天数 badge + 地图预览 + 操作按钮
- 操作按钮："进入日视图" `bg-primary` + "票据库" `bg-surface-container-high`
- 时间线：`left-[39px]` 竖线 + 发光圆点 + "进行中"/"已预订" 徽章
- 移除 TripNav（设计稿无此组件）

### DayViewPage (基于 `12_2/code.html`)
- Header：`bg-surface/80 backdrop-blur-md fixed top-0 h-14` + 返回 + "第N天 · 日期" `text-primary`
- 全屏地图：`absolute inset-0 bg-map-bg`
- 浮动信息卡：`fixed bottom bg-surface-container-high/95 backdrop-blur-md rounded-2xl shadow-2xl`
- 默认 map 视图（非 schedule）
- 移除 schedule 覆盖层

---

## 修复的关键 Bug

1. **TopAppBar 重复**：AppShell + 各页面各自渲染 header → 统一由 AppShell 管理
2. **BottomTabBar 搜索 tab disabled** → 改为可用
3. **TripNav 残留**：DayViewPage/TripWorkspacePage 有"总览/日程/地图/票据" → 移除
4. **双重浮动卡片**：DayViewPage + DayMapView 各有一个 → 移除 DayViewPage 的
5. **字号 token 命名错误**：`--text-*--size` → `--text-*`（Tailwind v4 正确格式）
6. **isTrip 页面 padding**：AppShell 对所有页面应用 `pt-24` → trip 页面不应用
7. **日期格式**：DayViewPage 显示星期 → 移除

---

## 未解决的差异（设计稿 vs 实现）

### 数据层面（无法修复）
- 设计稿有真实照片，实现用渐变色占位
- 设计稿有 4 个行程，实现只有示例数据
- 设计稿有地铁线路标签，实现无此数据

### 图标库差异（设计选择）
- 设计稿用 Material Symbols，实现用 Lucide React
- 图标样式略有不同（filled vs outline）

### 功能增强（设计稿无此功能）
- PlaceLookupPanel（地点搜索）
- AiTripEditPanel（AI 修改建议）
- RoutePreparationPanel（路线准备）
- TripBriefCard（行程简报）
- CloudSnapshotCheckPrompts（云快照检查）

---

## 关键文件清单

| 文件 | 用途 |
|------|------|
| `src/index.css` | Design Token 定义（颜色/字号/间距/毛玻璃） |
| `src/components/AppShell.tsx` | 全局 TopAppBar + BottomTabBar |
| `src/components/BottomTabBar.tsx` | 底部导航栏（4 tab） |
| `src/components/trip/TripCover.tsx` | 行程封面卡片 |
| `src/components/trip/DayMapView.tsx` | 地图视图 + 浮动信息卡片 |
| `src/components/ui/Button.tsx` | 按钮组件 |
| `src/components/ui/Card.tsx` | 卡片组件 |
| `src/components/ui/ListRow.tsx` | 列表行组件 |
| `src/components/ui/SectionHeader.tsx` | Section 标题 |
| `src/components/ui/SettingsSection.tsx` | 设置页 section/row/toggle 组件 |
| `src/pages/HomePage.tsx` | 首页 |
| `src/pages/ItemDetailPage.tsx` | 行程点详情页 |
| `src/pages/SettingsPage.tsx` | 设置页 |
| `src/pages/TripWorkspacePage.tsx` | 行程工作区页 |
| `src/pages/DayViewPage.tsx` | 日视图页（地图） |
| `src/pages/SettingsPrivacyPage.tsx` | 隐私设置子页 |
| `src/pages/SettingsMapsPage.tsx` | 离线地图子页 |
| `src/pages/SettingsRoutePage.tsx` | 路线偏好子页 |
| `src/types.ts` | RouteId 类型定义 |
| `src/lib/routes.ts` | 路由解析 |
| `src/App.tsx` | 路由渲染 |

---

## 用户反馈总结

1. **"直接在参考设计上改"** — 用户要求直接从参考 HTML 转换成 React，不是在旧代码上修补
2. **"设置页你改的挺好的"** — SettingsPage 重写方式被认可
3. **"为什么其他页面不能这么做"** — 用户期望所有页面都用同样方法重写
4. **"保留功能逻辑，只重写 JSX 结构"** — 最终确定的方法论
5. **"视觉 QA 不够"** — QA agent 太宽容，需要更严格的对比
6. **"代码 QA 也要"** — 不仅要视觉一致，代码质量也要检查
7. **"自驱动式"** — 用户希望自动化循环，不等手动指示

---

## 后续建议

1. **图标统一**：考虑引入 Material Symbols 或创建 Lucide → Material 映射
2. **照片支持**：ItineraryItem 添加 photo 字段，TripCover 支持真实照片
3. **SettingsPage 子页面**：隐私/地图/路线偏好子页面已创建，需要实际功能接入
4. **搜索功能**：BottomTabBar 搜索 tab 已启用但功能未实现
5. **深色地图**：OpenFreeMap 可能支持深色样式，需要调研
