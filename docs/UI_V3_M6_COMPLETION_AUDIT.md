# TripMap UI V3 M6 完成度审计

更新时间：2026-08-05

状态：**Candidate browser qualification passed; release qualification pending**

候选代码基线：`3a9fb8c`

上游合同：

- [产品定位与核心体验](PRODUCT_POSITIONING.md)
- [UI V3 重构规范](UI_REFACTOR_V3.md)
- [Selected Design](DESIGN.md)
- [Design System](DESIGN_SYSTEM.md)
- [UI V3 实施计划](UI_V3_IMPLEMENTATION_PLAN.md)

本文是 UI V3 的完成度收据和后续实施边界。它区分已经由真实代码证明的候选能力、仍需实体机或生产环境证明的发布门槛，以及不影响当前用户路径但需要继续治理的工程债。

## 1. 审计结论

- **M0-M5 候选实现：通过。** 四项导航、阶段化今日、连续日程、真实地图、地点详情、资料编辑式列表、按需 AI Action Sheet、费用、同行和四组设置均已进入真实 React 代码。
- **M6 浏览器资格：通过。** 固定视口、长内容、200% 文本、软件键盘、Reduced Motion、Light/Dark、无障碍、固定交互面、Golden、完整 E2E 和 PWA 升级均有自动化证据。
- **M6 候选代码本地质量门：通过。** `3a9fb8c` 的类型检查、Lint、单测、构建、Bundle budget、175 项串行 E2E 和 5 项 PWA 升级均通过。
- **M6 已推送结构基线远端资格：通过。** `73fe5af` 的 GitHub 五项 required checks 与 Cloudflare Pages Preview 按同一 SHA 通过；包含 S2-S3 的最终分支头仍需在推送后重跑远端资格。
- **M6 发布资格：未完成。** 真实 iPhone Safari/PWA、真实 Android Chrome/PWA、合并和同 SHA Production 部署仍待完成。
- **结构治理：S1-S3 已完成。** 首页、资料中心、设置、票据库、行程、日期、地点详情、全局 AI 和 AI 创建行程均已拆分控制、状态、ViewModel 与展示边界；现有保护合同和 Golden 未回归。

因此 UI V3 继续标记为 **Candidate**，不能改写为 Production Current。

## 2. 状态定义

| 状态 | 判定方式 |
| --- | --- |
| `passed` | 对应代码、测试收据或平台记录已经存在，并在当前候选上可复现 |
| `partial` | 用户路径已经可用，但计划中的工程治理或平台覆盖仍有明确缺口 |
| `pending` | 依赖尚未执行的实体机、远端或生产证据 |
| `historical` | 只描述旧方向或旧提交，不再作为当前视觉权威 |

不得用桌面移动视口或模拟器替代实体机发布结论；不得用生成稿替代真实组件；不得用旧远端通过记录替代最终待合并分支头。

## 3. 里程碑收据

| 里程碑 | 状态 | 已落地结果 | 主要收据 |
| --- | --- | --- | --- |
| M0 基线与隔离 | passed | Selected Target、fixture、改动归属和历史边界固定 | `UI_V3_M0_AUDIT.md`、`DESIGN.md` |
| M1 Shell 与共享组件 | passed | `今日 / 行程 / 资料 / 我的`、按需 AI、响应式 Tab/Rail/Sidebar、单一固定交互面 | `design-system-layout.spec.ts`、`mobile-ux-a11y.spec.ts` |
| M2 核心纵向流程 | passed | 导入、出发前准备、旅行中下一站、真实票据打开闭环 | `home-to-trip.spec.ts`、`documents-v3-visual.spec.ts`、`ticket-library.spec.ts` |
| M3 行程、地图与表单 | passed | 连续时间轴、真实地图、单一地点 Sheet、地点详情、渐进表单和 S2 控制边界拆分通过 | `trip-v3-visual.spec.ts`、`map-v3-visual.spec.ts`、`forms-v3-visual.spec.ts` |
| M4 搜索与 AI | passed | 上下文 Action Sheet、只读直达、一次确认、stale guard、部分失败重试 | `global-ai-command-bar.spec.ts`、`search.spec.ts` |
| M5 工具与设置 | passed | 费用、同行、低频页和四组设置统一到 V3 层级 | `low-frequency-v3-visual.spec.ts`、`settings-v3-visual.spec.ts` |
| M6 浏览器资格 | passed | 响应式、状态、无障碍、Golden、性能、完整 E2E、PWA | 本文第 4-7 节 |
| M6 实体机与发布 | pending | 真实设备、合并和 Production；代码变化后重跑候选远端 | 本文第 8-9 节 |

## 4. 体验验收矩阵

| 合同 | 自动化或记录 | 状态 |
| --- | --- | --- |
| `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900` | `home-v3-visual.spec.ts`、各页面视觉 E2E、Desktop smoke | passed |
| 长中文、长英文、无空格文件名不横向溢出 | `home-to-trip.spec.ts`、`ticket-library.spec.ts`、`item-detail.spec.ts` | passed |
| 200% 文本仍可操作 | `home-to-trip.spec.ts`、`mobile-ux-a11y.spec.ts` | passed |
| 软件键盘不遮挡核心输入和保存 | 表单 E2E、AI Sheet E2E、iOS/Android 模拟器记录 | passed for browser/simulator |
| Light / Dark | `appearance.spec.ts`、视觉 E2E | passed |
| Reduced Motion | `home-to-trip.spec.ts` 的真实 media emulation；`index.css.test.ts` 的全局合同 | passed |
| 同一时刻只展开一个固定底部交互面 | `home-to-trip.spec.ts`、地图 Sheet 与 AI Sheet E2E | passed |
| Loading、Empty、Error、Offline、Stale、Partial success | 页面单测、Provider/AI E2E、同步与 PWA E2E | passed |
| AI 关闭、输入、计划、确认、执行、部分失败 | `global-ai-command-bar.spec.ts` | passed |
| 无旅行、出发前、旅行中、旅行后 | Home 单测与视觉 E2E | passed |
| 地图 Canvas、Marker、路线、选中和降级列表 | `map-v3-visual.spec.ts`、`map-floating-info.spec.ts` | passed |
| 严重 axe 问题、焦点、触控目标 | `mobile-ux-a11y.spec.ts` 和 Modal/Sheet 组件测试 | passed |

真实 Provider 可用性不属于本次默认 fixture 验收。任何真实 AI、地点、路线、地图或其他 Provider 冒烟仍需要当前任务单独授权。

## 5. Golden 合同

Golden 不再只是截图命令，而是可执行回归：

- 测试入口：`e2e/ui-v3-golden-regression.spec.ts`。
- 基线装配：`e2e/uiV3GoldenBaseline.ts`。
- 固定基线提交：`2a858d5cd485ad4b19415f0288d1b36c25a1d098`。
- 同时固定 Git tree 和 `package-lock.json` object；任一不匹配即失败。
- 当前构建与基线构建使用同一脱敏 fixture、固定时钟、`390x844`、Light 和停用动画状态。
- 比较出发前今日、行程总览、资料列表和地点详情四个静态核心状态。
- 任一通道差值大于 `16` 的像素才计为变化，页面总差异比例必须 `<= 0.005`。
- 基线构建只存在于测试临时目录；成功时不提交截图，失败时才将当前图和基线图附加到 Playwright artifact。

有意修改核心视觉时，必须在同一审查中：

1. 证明变化符合 `DESIGN.md` 与 `DESIGN_SYSTEM.md`。
2. 更新固定 commit、tree 和 lock object 三项值。
3. 重新运行 Golden、五视口、Light/Dark、200% 文本和完整 E2E。
4. 在本审计或新的 QA 记录中说明批准的视觉变化。

不得仅提高差异阈值来消除失败。

## 6. 代码边界与后续结构计划

本轮已完成：

- `HomePage.tsx` 从混合页面收敛为约 205 行路由/加载控制器；旅行中展示和地图状态进入 `TodayWorkspace.tsx`，数据库聚合进入 `homeTripSnapshots.ts`。
- `TravelDocumentCenterPage.tsx` 收敛为约 447 行控制器；资料、证件、交通、同步和表单展示进入 `TravelDocumentCenterSections.tsx`。
- S1 的 `SettingsPage.tsx` 收敛为 12 行路由入口；浏览器存储、导入、偏好和 PWA 编排进入 `useSettingsPageController.ts`，四组设置进入 `SettingsPageView.tsx` / `SettingsSections.tsx`，纯展示计算进入 `settingsViewModel.ts`。
- S1 的 `TicketLibraryPage.tsx` 收敛为 25 行路由入口；票据加载、同步、编辑和确认编排进入 `useTicketLibraryController.ts`，列表、添加、编辑、预览与确认展示进入 `TicketLibraryView.tsx`，筛选、统计、搜索和输入归一化进入 `ticketLibraryViewModel.ts`。
- S2 的 `ItemDetailPage.tsx` 收敛为约 187 行路由/控制入口，详情内容进入 `ItemDetailContent.tsx`；`DayViewPage.tsx` 收敛为约 369 行，工作区、菜单、视图模型和地图加载边界分别进入 `DayWorkspaceView.tsx`、`DayMoreMenu.tsx`、`dayWorkspaceViewModel.ts` 与 `dayWorkspaceMapLoader.ts`。
- S2 的 `TripWorkspacePage.tsx` 收敛为约 246 行路由/控制入口，工作区展示、聚合和视图模型分别进入 `TripWorkspaceView.tsx`、`useTripWorkspaceAggregates.ts` 与 `useTripWorkspaceViewModel.ts`。
- S3 的 `GlobalAiCommandBar.tsx` 收敛为约 213 行展示壳，Action Gateway、兼容编辑、确认、stale guard 和失败项重试编排进入 `useGlobalAiCommandController.ts`。
- S3 的 `AiDraftPage.tsx` 收敛为 7 行路由入口；请求状态进入 `useAiDraftRequestFormState.ts`，Provider/草稿/导入编排进入 `useAiDraftController.ts`，表单、地图、多方案和结果展示进入 `AiDraftWorkspace.tsx` 与 `components/ai/AiDraft*`。
- 上述拆分由页面单测、聚焦 E2E、Golden、完整串行 E2E 和 PWA 升级证明行为、隐私过滤、确认门控与像素未回归。

结构计划状态：

| 优先级 | 状态 | 页面 | 边界与完成条件 |
| --- | --- | --- | --- |
| S1 | passed | `SettingsPage.tsx`、`TicketLibraryPage.tsx` | 薄路由入口 + controller hook + ViewModel + 展示组件；设置、票据和 Golden 全量回归不变 |
| S2 | passed | `TripWorkspacePage.tsx`、`DayViewPage.tsx`、`ItemDetailPage.tsx` | 数据聚合 hook、页面 ViewModel、Sheet/菜单和详情展示已拆分；地图/日程上下文、返回来源和 Golden 不变 |
| S3 | passed | `AiDraftPage.tsx`、`GlobalAiCommandBar.tsx` | 编排控制器、请求表单状态和结果展示已拆分；Action Gateway、隐私过滤、确认门控和 stale guard 不变 |

S1-S3 结构计划已关闭。后续工程治理仍不得顺带重写 IndexedDB、Supabase、Provider、路线缓存、票据 Blob 或 AI 安全合同；新的结构改动继续以现有 Golden 和完整 E2E 作为零行为回归门槛。

## 7. 当前自动化证据

最终候选代码 `3a9fb8c` 的本地结果：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | passed，覆盖应用、Provider runtime 和 Travel Inbox Worker |
| `npm run lint` | passed，无 warning |
| `npm run test:unit` | `191 / 191` 文件、`1578 / 1578` 测试 passed |
| `npm run build` | passed；入口 `468.2 KiB`，初始 JS `852.4 KiB`，初始 gzip `245.5 KiB` |
| Bundle/PWA budget | passed；`8` 个启动 chunk，`2337.3 KiB / 114` 项 precache |
| S3 AI Draft 聚焦单测 | `118 / 118` passed |
| S3 AI Draft + Golden 聚焦 E2E | `47 / 47` passed，约 `1.7m` |
| `npm run test:e2e:serial` | `175 / 175` passed，约 `6.6m` |
| `npm run test:e2e:pwa-upgrade` | `5 / 5` passed，约 `46s` |
| `git diff --check` | passed |

已推送的 S1 结构基线 `73fe5af` 的远端结果：

- GitHub Actions run `30992807064` 的 `Lint`、`Type Check`、`Unit Tests`、`Build` 和 `E2E Tests` 全部 passed；E2E job 用时约 `5m09s`。
- Cloudflare Pages Preview deployment `4e2542bd-19b8-442d-90b8-8f1697dad436` 为 Active，Source 为 `73fe5af`。
- 包含 S2-S3 的最终分支头需在推送后重新核验；不得复用本段的旧 SHA 结果。

## 8. 平台与发布矩阵

| 环境 | 状态 | 结论 |
| --- | --- | --- |
| Chromium 固定视口 | passed | 完整自动化与 Golden 通过 |
| Desktop `1440x900` | passed | 核心页面和 AI 确认边界通过 |
| iPhone 16 / iOS 26.5 Simulator Safari | passed as supplemental | 布局、键盘、地图和 AI Sheet 通过；不替代实体机 |
| Android API 33 Emulator WebView | passed as supplemental | `100vh` 回退、键盘、地图和横向溢出通过；不替代 Chrome/PWA 实体机 |
| 真实 iPhone Safari/PWA | pending | 当前没有在线可用设备 |
| 真实 Android Chrome/PWA | pending | 当前没有连接设备 |
| Cloudflare Pages Preview | passed for S1 baseline | deployment `4e2542bd-19b8-442d-90b8-8f1697dad436` 指向 `73fe5af` 并为 Active；S2-S3 最终分支头待重跑 |
| Cloudflare Pages Production | pending | 只在实体机门槛通过并合并后核验 |

## 9. 发布执行顺序

1. 推送包含 S2-S3 与本审计的最终候选分支头，核验 GitHub 五项 required checks 和 Cloudflare Pages Preview 指向同一 SHA。
2. 在真实 iPhone Safari/PWA 和 Android Chrome/PWA 完成安装、冷启动、登录、软件键盘、地图、票据、文件选择、弱网和升级。
3. 将实体机结果补录到 `BETA_QA_RECORD.md`；任一 P0/P1/P2 先修复并重跑完整门槛。
4. 若实体机修复改变候选代码，再次核验最终待合并提交的 GitHub 五项 required checks 和 Cloudflare Pages Preview。
5. 通过 PR 合并到 `main`，不使用实体机模拟记录替代发布确认。
6. 核验 Cloudflare Pages Production 指向合并后的同一 SHA，并执行不触发真实 Provider 的生产 smoke。
7. 只有全部完成后，才将 UI V3、`design-qa.md`、`PROJECT_STATUS.md` 和 Beta Readiness 改为 Production Current。

回退单位是最近一个已通过 required checks 的提交。UI 回退不得连带回滚用户数据、schema、云端权限或票据存储。

## 10. 最终判定

当前判定：**视觉、浏览器和 S1-S3 结构验收通过；最终候选远端、实体机与生产发布待完成。**

这份审计关闭“规划是否真正落到代码和可执行门槛”的问题，但不关闭尚未发生的实体机和生产事实。
