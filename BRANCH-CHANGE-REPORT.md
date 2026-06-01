# TripMap 分支改动汇报

日期: 2026-06-01
分支: `feature/swiftui-design-system-pass-1`
基准: `main`
状态: 合并前功能回归修复、UI 清理和自动化验证已完成；尚未 stage、commit、push 或 merge。

## 总览

本分支把 TripMap PWA 大范围对齐到 `stitch_tripmap_ios_ui_system` 的 iOS/HIG 风格，同时修复视觉改版中引入的功能回归。核心结果是：页面框架、底部导航、设置页、首页、旅行总览、日视图、行程点详情、票据库和 AI/云端相关入口都回到可用状态，并补上了回归测试。

本轮收尾重点清理了日视图地图页：最终只保留浮动信息栏、定位按钮和地图本身，删除旧底部抽屉、路线 chip、地图页内路线生成控制和相关死代码。已有路线缓存仍可被读取并渲染到地图上，未改变路线缓存、provider、云同步、AI 隐私、IndexedDB schema 或导入格式语义。

## 主要改动

### 视觉系统与全局框架

- 引入并扩展 MD3 / Stitch 风格 token，包括颜色、字体、字号、间距、圆角、毛玻璃和 surface/on-surface 语义。
- 重写 `AppShell` 顶栏和底部导航，统一 TopAppBar / BottomTabBar 在主要页面中的展示。
- 新增并使用 `BottomTabBar`、`GroupedSection`、`SettingsSection` 等基础 UI 组件。
- 调整通用组件样式，包括 `Button`、`Card`、`ListRow`、`SectionHeader`、`BottomSheet`、`ConfirmDialog`、`FormField`、`EmptyState` 等。

### 首页与新建旅行入口

- 首页重写为设计稿风格的 TripMap 首屏和旅行列表体验。
- 恢复底部主 CTA 的产品语义和可访问名为“新建旅行”，继续导航到 `/#/trip/new`。
- 保留“创建示例旅行”和“导入行程”等入口，不改变旅行创建、表单或数据写入逻辑。
- 增加 `HomePage` 相关单元测试与 E2E 契约验证。

### 旅行总览

- `TripWorkspacePage` 对齐设计稿布局，重组旅行封面、摘要、地图预览、行程天数、票据和 AI 修改建议等区域。
- 日程天数入口改成与日视图一致的横向 Day 选择样式，使用稳定链接/按钮契约进入对应日视图。
- Trip Home 路线准备、缓存路线预览、AI 修改建议、搜索意图确认和云端保存冲突提示继续走原有安全边界。
- 新增 `TripWorkspacePage.test.tsx`，覆盖总览页关键展示和交互。

### 日视图与地图页

- `DayViewPage` 调整为专用 header + 日程/地图双视图布局，页面样式与旅行总览保持一致。
- 修复从总览 Day 1 / Day 2 进入日视图时布局不统一、Day 1 坐标点击可能不可用的问题。
- `DaySelector` 支持 `getDayHref`，在需要真实 hash 导航时渲染 anchor 风格入口，提升移动端点击稳定性。
- 地图页删除底部抽屉，最终只保留浮动信息栏、回到当天范围、显示当前位置、地图控制提示和地图 marker 选择。
- `DayMapView` 删除旧 `MapBottomSheet`、`RouteStatusChip`、路线控制面板、抽屉内行程列表、拖拽 snap、地图页直接生成/清理路线等代码。
- `DayMapView` 接口收窄，移除旧抽屉遗留的 `onEditItem`、`onItemsChange` props，并固定 marker 来源选择，不再暴露无用的 list 来源状态。
- 已有路线缓存仍通过 `routeCache` 读取并作为 `routeLineStrings` 传给地图，不触发真实路线服务调用。
- E2E 从 `map-sheet.spec.ts` 重命名为 `map-floating-info.spec.ts`，测试语义改为“无抽屉 + 浮动信息栏”。

### 旅行页标题语义

- `App` 根据当前 trip 路由读取旅行标题并传入 `AppShell`。
- `AppShell` 增加 `title` prop，顶栏 `header h1` 在旅行页显示当前旅行名，非 trip 路由仍显示“旅图”。
- 订阅旅行数据变更，AI 导入、云端恢复、本地编辑后顶栏标题会刷新。
- 顶栏布局改为固定左右按钮 + 中间可截断标题，长旅行名在移动宽度下不挤压布局。

### 设置页功能回归

- `SettingsPage` 恢复视觉改版时丢失的完整设置功能面：外观、旅行偏好、AI 隐私、PWA/离线、zip 备份导入、云端保存、AI 行程包导入、路线服务、设备存储和关于信息。
- 外观区恢复 system / light / dark 三段式按钮，继续写入 `tripmap:appearance`。
- 旅行偏好与 AI 隐私继续写入原 localStorage key，不进入 IndexedDB、zip 或 Supabase。
- `allowTicketFileContent` 保持 disabled。
- 云端保存继续由 `CloudBackupPanel trip={null}` 管理登录、登出、上传和恢复。
- Supabase 未配置时只展示未配置提示和禁用态，不显示登录、上传或列表操作。
- AI 行程包导入保持本地 JSON/zip 解析、预览、警告、错误、成功清单和跳转旅行工作台。

### AI、隐私、搜索和 Provider 边界

- AI 相关本地库整理到 `src/lib/ai/`，相关 imports 和测试同步更新。
- AI 草稿、AI 行程导入、AI 修改建议、搜索意图和修复请求继续保持预览 + 确认机制。
- Provider proxy 相关代码和测试同步适配路径/契约更新。
- 搜索 tab 和 `SearchPage` 接入，但搜索仍遵守来源和确认边界。
- 未进行真实 AI、搜索、路线或云端外部调用。

### 行程点详情、票据与表单

- `ItemDetailPage` 对齐设计稿 hero、信息分组、票据摘要、上下项导航和地图来源返回上下文。
- `TicketLibraryPage` 和 `TicketPreview` 保持 gallery、预览、缩略图、PDF/外部票据展示和 Escape 关闭能力。
- `TripFormPage`、`ItemFormPage` 等全页表单保持路由和数据写入契约。
- 新增/扩展 `ItineraryItemForm`、首页、旅行总览等单元测试。

## 回归测试与契约

- 设置页关键 test id 恢复并保持可见，包括 `appearance-settings`、`travel-profile-section`、`ai-privacy-section`、`cloud-backup-section`、`routing-settings-section`、`ai-trip-plan-*`。
- 首页恢复 `getByRole('button', { name: '新建旅行' })`。
- 旅行页恢复 `header h1` 显示当前旅行标题。
- 地图页新增/更新契约：不渲染 `map-sheet`、`map-sheet-handle`、`route-chip`、`route-controls-section`；浮动信息栏使用 `map-marker-card`。
- 日视图 Day 1 / Day 2 使用真实坐标点击验证，防止浮层遮挡或点击落空。

## 验证记录

本分支当前工作树已通过以下验证：

- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run test:unit` 通过：65 个 test files，702 个 tests。
- `npx playwright test e2e/map-floating-info.spec.ts e2e/trip-workspace.spec.ts e2e/item-detail.spec.ts` 通过：25 个 tests。
- `npm run test:e2e` 通过：78 个 tests。
- `git diff --check` 通过。

## 当前工作树说明

- 当前仍未 stage / commit / push / merge。
- 代码变更集中在日视图地图、Day selector、旅行总览、相关 E2E，以及本报告文档。
- `e2e/map-sheet.spec.ts` 已重命名为 `e2e/map-floating-info.spec.ts`。
- `test-results` 已清理，不应提交本地测试产物。

## 合并前建议

1. 再次检查 `git status --short`，确认只有预期源码、测试和本报告文件。
2. 显式 stage 需要提交的文件，避免使用 `git add .`。
3. 提交前可再次运行 `git diff --check`；当前已通过。
4. 如需保留本报告，请把 `BRANCH-CHANGE-REPORT.md` 作为文档产物提交；如只作为本地汇报，可不提交。
