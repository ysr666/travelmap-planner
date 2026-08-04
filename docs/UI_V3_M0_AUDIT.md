# TripMap UI V3 M0 基线审计

更新时间：2026-08-05

状态：**Current implementation evidence**

对应计划：[UI V3 实施计划](UI_V3_IMPLEMENTATION_PLAN.md)

本页记录 `feature/ui-v3-product-shell` 在 UI V3 继续实施前的工作树归属。它只说明改动如何进入后续阶段，不把当前界面误标为已经完成的 V3。

## 保留

- App Shell 已具备单一 Header、四项自适应主导航、AI 按需挂载和安全区管理的基础。
- 地图已具备真实 Canvas、路线与停止序列的诚实区分、单一地点 Sheet、Google/MapLibre 适配和稳定 fixture。
- 地点详情已经把名称、时间、地址、导航和关联票据放到首屏，并覆盖长名称换行。
- 表单已经采用基本信息、地点和更多设置的渐进披露，并覆盖软件键盘状态。
- 设置已形成四组一级入口，云端和技术诊断默认进入二级或折叠区域。
- 收件箱已支持直接文件导入、紧凑待整理列表和默认关闭的来源 Sheet。
- 当前 V3 视觉测试覆盖五个规定视口，且默认使用 fixture/mock，不触发未授权 Provider 请求。

## 拆分后继续

- Shell、主导航、路由映射和语义 Token 归入 M1。
- Today 阶段化内容、票据入口和一键修复归入 M2。
- 行程时间轴、地图、地点与表单归入 M3。
- 资料、搜索和 AI Action Sheet 归入 M4。
- 费用、同行与设置归入 M5。
- Golden、响应式、无障碍、完整 E2E、PWA 和实体机证据归入 M6。
- `HomePage.tsx`、`TripWorkspacePage.tsx`、`DayViewPage.tsx`、`ItemDetailPage.tsx`、`TicketLibraryPage.tsx`、`SettingsPage.tsx`、`AiDraftPage.tsx` 和 `GlobalAiCommandBar.tsx` 继续拆分 ViewModel 与展示组件，不能把当前大文件规模视为完成状态。

## 独立修复

- Google/MapLibre 路线样式区分属于地图真实性修复，不改变 Provider 请求合同。
- 邮箱验证码按请求后显示、缺失会话回到登录态属于账户错误状态修复。
- 手动导入文件的数量、类型、大小和重复内容检查属于收件箱可靠性修复。
- 长票据名称、地址和无空格文件名的换行与 `min-width: 0` 属于跨页面布局修复。

## Historical，必须替换

- 旅行中 Today 以地图占据整个首屏、所有阶段共用地图工作台。
- 行程页把 `日程 | 地图 | 资料 | 费用` 并列为同级标签。
- 主导航显示 `收件箱`，资料只能从行程内部进入。
- 资料默认使用双列 PDF 卡片画廊，文件类型头图承担主要预览。
- 页面常驻多组建议、诊断、同步说明或 Provider 技术文案。
- 页面私有固定底栏与主导航、AI Sheet 或地图 Sheet 同时出现。

## 基线结果

2026-08-05 在当前工作树执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过，无警告。
- `npm run test:unit`：`190` 个文件、`1574` 个测试通过。
- `npm run build`：通过，Bundle budget 通过。
- UI V3 重点视觉 E2E：`11 / 11` 通过。
- `git diff --check`：通过。

这些结果证明当前候选改动可作为迁移起点，不证明 Selected Target 已完成。后续阶段仍须逐项替换上面的 Historical 行为，并重新生成真实代码 Golden Screenshots。
