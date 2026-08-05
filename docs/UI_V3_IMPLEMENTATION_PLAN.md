# TripMap UI V3 实施计划

更新时间：2026-08-05

状态：**Current; M0-M6 complete**

上游合同：

- [产品定位与核心体验](PRODUCT_POSITIONING.md)
- [UI V3 重构规范](UI_REFACTOR_V3.md)
- [Selected Design](DESIGN.md)
- [Design System](DESIGN_SYSTEM.md)
- [M6 完成度审计](UI_V3_M6_COMPLETION_AUDIT.md)

本页把已经选定的 UI V3 方向转化为可分批开发、独立验收和安全合并的工程计划。2026-08-05 已完成 M0-M5、M6 浏览器与平台模拟器验收，以及 S1 Settings/Tickets、S2 Trip/Day/Item、S3 AI 控制边界收口。PR #33 合并提交 `9317a9a` 的 GitHub Actions run `31015131693` 五项 required jobs、Cloudflare Pages Production deployment `6647a145-87c9-45a3-b602-059deb450ac3` 和无 Provider 生产冒烟均通过。项目所有者批准以 iOS/Android 模拟器和 built-dist PWA 自动化作为发布设备标准，实体机为发布后观察。UI V3 现为 Production Current；逐项收据见 [M6 完成度审计](UI_V3_M6_COMPLETION_AUDIT.md)。

## 实施进度

| 阶段 | 状态 | 主要证据 |
| --- | --- | --- |
| M0 基线与改动隔离 | 完成 | `UI_V3_M0_AUDIT.md`、基线检查、fixture 归属 |
| M1 Shell 与共享组件 | 完成 | 四项导航、按需 AI、共享 Row/Section/Disclosure/Form 组件 |
| M2 核心纵向流程 | 完成 | 阶段化 Today、资料编辑式列表、一键修复入口 |
| M3 行程、地图与表单 | 完成 | 连续时间轴、单一地图 Sheet、渐进表单、五视口 Golden 和 S2 控制边界拆分 |
| M4 搜索与 AI | 完成 | 上下文 Action Sheet、一次确认、部分失败重试和展示层拆分 |
| M5 费用、同行与设置 | 完成 | 行程 More、低频页统一、四组设置与默认收起技术项 |
| M6 产品级验收与发布 | 完成 | 191 文件/1578 单测、175/175 E2E、5/5 PWA、可执行 Golden、iOS/Android 模拟器、同 SHA CI/Preview/Production 和无 Provider smoke 全部通过 |

M0-M6 已全部完成并发布；后续变化继续以第 10 节的 Definition Of Done 防止回归。

## 1. 交付目标

UI V3 要在不重写数据合同的前提下，完成以下用户结果：

1. 用户打开应用后，立即看清当前旅行阶段和下一步。
2. 出发前可以一次处理真正阻塞出行的问题，并直接看到已就绪的机票、住宿和保险。
3. 旅行中可以在两次操作内开始导航或打开所需票据。
4. 行程、地图、地点和资料使用同一导航、层级和视觉语言。
5. AI 作为按需动作层完成查询、预览、确认、执行和失败重试，不常驻遮挡内容。
6. 资料默认使用高效编辑式列表，真实缩略图和关键元数据优先。
7. 设置、费用、同行和高级工具保持完整，但不与核心旅行任务争夺首屏。

Selected Target 固定为：

- 出发前“今日”采用第一套方向左上角页面的信息组织。
- 全局视觉采用第二套“随身旅夹”的旅行对象语言。
- 资料采用第三套左侧缩略图、右侧元数据的编辑式列表。
- 高信息量来自真实对象、稳定分组和清晰层级，不来自缩小字号、重复摘要、长文案或卡片堆叠。

## 2. 范围与边界

### 本计划包含

- App Shell、标题栏、四项主导航和自适应布局。
- 未建旅行、出发前、旅行中和旅行后的阶段化“今日”。
- 行程总览、单日日程、地图、地点详情和创建/编辑表单。
- 资料列表、票据详情、待整理材料和来源与导入。
- 全局搜索、AI Action Sheet 和 AI 创建行程。
- 费用、费用详情、同行、我的和全部设置页面。
- 响应式、无障碍、性能、Golden Screenshot、E2E、PWA 和平台模拟器验收。

### 本计划不包含

- IndexedDB 或 Supabase schema 变更。
- 云端覆盖语义、Realtime 版本合同或 Shared Trip 数据合同重写。
- Provider 请求/响应合同、路线缓存、票据 Blob 或 AI 隐私边界调整。
- 自动删除行程、取消订单、付款、发邮件或修改云端权限。
- 新建独立移动端工程、替换现有 React/Vite PWA 或从生成稿导入代码。

保护边界继续成立：AI 写入必须保留真实预览、一次最终确认、状态指纹、幂等和失败项重试。

## 3. 实施起点（历史快照）

规划快照：2026-08-05。以下内容记录开始实施时的约束，不再代表候选分支当前工作树状态；当前完成度以 [M6 审计](UI_V3_M6_COMPLETION_AUDIT.md) 为准。

- 实施分支为 `feature/ui-v3-selected-target`。
- 起点工作区已有 App Shell、地图、票据、设置、表单和 E2E 改动；它们已按 M0 审计保留并归类，没有通过 reset 或覆盖清除。
- 原始大型页面需拆分 ViewModel、状态和展示组件。首页、资料中心和 S1-S3 页面均已完成边界收口；后续只在有明确维护收益时继续拆分，不以行数本身驱动重写。
- 当前 Hash URL 和深链接继续兼容；UI V3 先替换呈现和导航映射，不同时重写路由合同。
- 现有 E2E 已覆盖首页、行程、地图、地点、资料、AI、表单、设置、账本、同行和 PWA 升级，可作为迁移基线。

## 4. 实施方法

不按 32 张设计稿逐页复制，而按以下顺序落地：

```mermaid
flowchart LR
    M0["M0 基线与改动隔离"] --> M1["M1 Shell 与共享组件"]
    M1 --> M2["M2 核心纵向流程"]
    M2 --> M3["M3 行程、地图与表单"]
    M2 --> M4["M4 搜索与 AI"]
    M3 --> M5["M5 费用、同行与设置"]
    M4 --> M5
    M5 --> M6["M6 产品级验收与发布"]
```

原则：

- **共享系统先行**：先解决壳层、Token、固定区域和基础组件，再迁移页面。
- **纵向流程优先**：先完成“导入材料 → 出发前今日 → 旅行中下一步 → 打开票据”。
- **逐路由替换**：新页面通过现有 Hash Route 接入；旧实现保留到对应路由和回归测试通过。
- **真实对象优先**：设计稿只决定层级和视觉，内容来自当前数据库、fixture、真实地图和真实票据预览。
- **每阶段可发布**：每个阶段都必须功能完整、可回退、测试通过，不留下只显示不能操作的核心控件。
- **不并行重写保护边界**：UI PR 不混入 schema、同步、Provider、缓存或 AI 安全合同变更。

## 5. 阶段计划

### M0：基线与现有改动隔离

**目标**

把当前分支整理成可审查、可回退的 UI V3 起点，避免把历史地图试验、当前修复和新 Selected Target 混为一个不可验证的大改动。

**工作内容**

- 按 Shell、地图、资料、表单、低频页面、测试和文档分类当前 tracked diff。
- 标记哪些改动符合 Selected Target，哪些只属于 Historical 方向，哪些是独立 bug fix。
- 保留用户已有改动；不使用 reset、checkout 或批量覆盖。
- 固定现有 route fixture、真实地图 fixture、长票据名称和阶段化 Today fixture。
- 捕获 Current 基线截图，并登记 Selected Target 的同状态参考。
- 将当前分支整理为小而清晰的提交；只 stage 明确文件。

**主要文件**

- `src/components/AppShell.tsx`
- `src/components/BottomTabBar.tsx`
- `src/index.css`
- `src/pages/*`
- `e2e/*-v3-visual.spec.ts`
- `docs/DESIGN.md`
- `design-qa.md`

**退出条件**

- 当前改动来源和归属清楚，没有误删用户改动。
- `git diff --check` 通过。
- `npm run typecheck`、`npm run lint`、`npm run test:unit` 和 `npm run build` 有可复现基线。
- 关键 E2E 的现有失败已区分为分支回归、旧基线问题或环境问题。
- 后续阶段从明确提交开始，不继续在不可审查的混合 diff 上扩展。

### M1：App Shell 与共享组件

**目标**

建立所有页面共用的固定区域、导航、视觉 Token 和基础交互组件。

**工作内容**

- `AppScaffold` 统一管理安全区、Header、Primary Navigation、Modal、z-index 和内容 inset。
- 移动端固定 `今日 | 行程 | 资料 | 我的`；平板使用 Rail，桌面使用 Sidebar 和主从布局。
- AI 和 Search 变为 Header/内容命令，不占底部导航。
- 建立 `ContextHeader`、`Section`、`StatusStrip`、`RecordRow`、`TimelineRow`、`DocumentPreviewRow`、`DisclosureRow`、`FormSection`、`FilterSheet` 和 `AiActionSheet` 壳层。
- 将颜色、字体、间距、圆角、阴影、焦点和状态统一为语义 Token。
- 固定一个底部交互面规则：主导航、AI Sheet、地图地点 Sheet 和 sticky action 不得同时堆叠。

**主要文件**

- `src/components/AppShell.tsx`
- `src/components/BottomTabBar.tsx`
- `src/components/shell/routePresentation.ts`
- `src/components/ui/*`
- `src/index.css`

**测试**

- `src/components/AppShell.test.tsx`
- `src/components/shell/routePresentation.test.ts`
- `e2e/design-system-layout.spec.ts`
- `e2e/mobile-ux-a11y.spec.ts`
- `e2e/desktop-beta-smoke.spec.ts`

**退出条件**

- 四项主导航在所有核心路由映射正确，Search/AI 返回来源上下文。
- AI 关闭时不占内容空间，Modal 打开时没有第二个固定底栏。
- `320x568` 到 `1440x900` 不出现居中手机长条、重复导航或固定区域重叠。
- Shared primitives 覆盖默认、Loading、Error、Empty、Selected、Disabled、Long content 和 Dark 状态。

### M2：核心纵向流程

**目标**

先完成最能验证产品定位的真实闭环：

```text
导入材料
→ 出发前“今日”
→ 一键智能修复预览/确认
→ 旅行中下一站
→ 打开真实票据
```

**工作内容**

- 无旅行首页：导入为主操作，AI 创建为第二入口，手动新建为次要入口。
- 出发前首页：倒计时、唯一阻塞项、机票/住宿/保险和至多一条必要事实。
- 旅行中首页：下一站、出发时间、交通、导航和关联票据；移动时才突出地图。
- 资料首页：使用 `DocumentPreviewRow` 编辑式列表，不使用双列卡片画廊。
- 票据详情：显示真实图片、二维码或 PDF 首页，支持打开原件和返回来源上下文。
- 一键修复继续复用 Trip Readiness 与 Action Gateway，不在 UI 层复制修复逻辑。

**主要文件**

- `src/pages/HomePage.tsx`
- `src/components/trip/TripReadinessCenterPanel.tsx`
- `src/pages/TravelDocumentCenterPage.tsx`
- `src/pages/TicketLibraryPage.tsx`
- `src/components/tickets/TicketThumbnail.tsx`
- `src/pages/ItemDetailPage.tsx`

**测试**

- `src/pages/HomePage.test.tsx`
- `src/pages/TicketLibraryPage.test.tsx`
- `src/pages/ItemDetailPage.test.tsx`
- `e2e/home-to-trip.spec.ts`
- `e2e/home-v3-visual.spec.ts`
- `e2e/travel-document-center.spec.ts`
- `e2e/ticket-library.spec.ts`
- `e2e/item-detail.spec.ts`

**退出条件**

- 用户可以用真实 fixture 完成完整纵向流程，核心按钮均可操作。
- 出发前首页在 3 秒扫读内呈现倒计时、阻塞项和已就绪对象。
- 旅行中两次操作内开始导航或打开票据。
- 精确 AI 票据查找直接打开原件并关闭 AI；宽泛查找进入资料列表。
- `390px` 长文件名、地址和票据名称无横向溢出。

### M3：行程、地图、地点与表单

**目标**

把核心旅行组织和现场执行页面迁移到同一视觉和组件系统。

**工作内容**

- 行程总览显示日期、城市、时间范围、地点数和关键票据状态。
- 单日日程使用连续时间轴和交通连接，日程默认、地图为视图切换。
- 地图使用真实 Map Canvas、路线和 Marker；只存在一个地点 Sheet。
- 地点详情首屏显示名称、时间、地址、导航和票据；Provider 诊断进入“更多”。
- 新建/编辑旅行和行程点采用基本信息、地点、更多设置三级渐进披露。
- 拆分大型页面的 ViewModel、异步状态和展示组件，页面目标约 `500` 行以内。

**主要文件**

- `src/pages/TripWorkspacePage.tsx`
- `src/pages/DayViewPage.tsx`
- `src/components/trip/DayMapView.tsx`
- `src/components/DayMap.tsx`
- `src/pages/ItemDetailPage.tsx`
- `src/pages/TripFormPage.tsx`
- `src/pages/ItemFormPage.tsx`

**测试**

- `e2e/trip-workspace.spec.ts`
- `e2e/trip-v3-visual.spec.ts`
- `e2e/map-v3-visual.spec.ts`
- `e2e/map-floating-info.spec.ts`
- `e2e/item-detail-v3-visual.spec.ts`
- `e2e/forms-v3-visual.spec.ts`
- `e2e/full-page-forms.spec.ts`

**退出条件**

- 日程、地图和详情之间保持同一日期、选中地点和返回上下文。
- 动态地图 Canvas 非空，Marker、路线和控件可见且不被 Header/Sheet 遮挡。
- 地点详情不存在重复地址、重复地图入口或文件名溢出。
- 软件键盘打开时表单字段和保存操作仍可到达。

### M4：搜索与 AI 动作层

**目标**

将全局 AI 从页面覆盖物收敛为真正完成任务的按需动作层，并保持搜索和 AI 的语义区别。

**工作内容**

- 全局搜索按旅行、行程点、资料和费用分组，精确对象优先。
- AI Action Sheet 使用当前 Trip/Day/Item/Ticket 上下文，不要求用户再次选择范围。
- 只读导航动作可以自动完成并关闭 Sheet。
- 写入计划只显示一句摘要、步骤数、影响对象、折叠详情和一次“确认执行”。
- 部分失败显示完成/失败数量和“重试失败项”，不重复成功步骤。
- AI 创建行程使用基本输入、折叠偏好、真实预览和一次采用确认。
- `GlobalAiCommandBar.tsx` 拆分输入、计划、执行结果和展示状态；不改变 Action Gateway 注册表和隐私过滤。

**主要文件**

- `src/components/ai/GlobalAiCommandBar.tsx`
- `src/lib/ai/actionGateway/*`
- `src/lib/ai/globalAiCommandRouter.ts`
- `src/pages/SearchPage.tsx`
- `src/pages/AiDraftPage.tsx`

`src/lib/ai/actionGateway/*` 在本阶段只允许兼容性接线和测试补充；动作合同、隐私边界或 Provider schema 变化必须单独立项。

**测试**

- `e2e/global-ai-command-bar.spec.ts`
- `e2e/search.spec.ts`
- `e2e/ai-draft.spec.ts`
- `e2e/ai-trip-import.spec.ts`
- `e2e/ai-profile-privacy.spec.ts`
- Action Gateway 现有单元测试。

**退出条件**

- AI 关闭零遮挡，成功导航后自动关闭并聚焦目标。
- 写入只确认一次，过期计划不写入，部分失败可以只重试失败项。
- 票据查找、补地点和一键修复使用同一动作语言和结果结构。
- UI 不显示 raw Provider 输出、堆栈、schema、quota、cache 或长解释。

### M5：旅行工具与设置

**目标**

完成低频页面统一，同时保持核心体验的优先级。

**工作内容**

- 行程 More 收纳同行、费用、编辑、导出和旅行设置。
- 费用页面使用紧凑总览、分类条和可扫读明细；费用详情关联真实票据和行程点。
- 同行页面显示成员、角色、邀请和结算状态，不暴露云端技术细节。
- “我的”固定四组：账户与同步、旅行偏好、应用与通知、数据与高级。
- 偏好使用 segmented control、toggle、时间输入等熟悉控件。
- 地图、路线、数据和诊断进入二级页面，默认收起技术内容。

**主要文件**

- `src/components/trip/TripMoreMenu.tsx`
- `src/pages/LedgerPage.tsx`
- `src/pages/LedgerExpenseDetailPage.tsx`
- `src/pages/SharedTripPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/SettingsPrivacyPage.tsx`
- `src/pages/SettingsMapsPage.tsx`
- `src/pages/SettingsRoutePage.tsx`

**测试**

- `e2e/trip-ledger.spec.ts`
- `e2e/shared-trip.spec.ts`
- `e2e/settings-v3-visual.spec.ts`
- `e2e/low-frequency-v3-visual.spec.ts`
- `e2e/appearance.spec.ts`

**退出条件**

- 费用、同行和设置均从正确次级入口可达，不新增顶层 Tab。
- 设置一级只有四组，技术项不占普通页面首屏。
- 危险操作隔离、明确且继续确认门控。
- 低频页面与核心页面使用同一 Header、Row、Section、Form 和 Sheet。

### M6：产品级验收与发布

**目标**

用真实代码截图、自动化和平台模拟器结果替代生成稿，完成可发布判断。

**视觉矩阵**

- `320x568`
- `390x844`
- `430x932`
- `768x1024`
- `1440x900`
- Light / Dark
- `200%` 文本缩放
- 软件键盘打开
- Reduced Motion
- 长中文、长英文和无空格文件名

**状态矩阵**

- Loading、Empty、Error、Offline、Stale、Partial success。
- AI 关闭、输入、计划、确认、执行、部分失败。
- 无旅行、出发前、旅行中、旅行后。
- 地图未选中、选中地点、路线不可用和降级列表。
- 资料有内容、待整理、预览失败和长名称。

**完整命令**

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e:serial
npm run test:e2e:pwa-upgrade
```

**额外门槛**

- 核心静态 Golden 通过固定 commit/tree/lock 的临时真实构建执行，目标 `maxDiffPixelRatio <= 0.005`；不得只保留人工截图命令。
- 每个核心页面满足 `scrollWidth <= clientWidth`。
- axe/WCAG 2.2 AA、焦点顺序、Sheet 焦点陷阱和触控目标通过。
- `prefers-reduced-motion: reduce` 必须在真实浏览器 media emulation 下停用可见动效，并由 CSS 合同单测防止全局规则丢失。
- Bundle budget 不回归；Map、PDF、OCR、AI 和 JSZip 保持按需加载。
- iPhone 16 / iOS 26.5 Simulator 完成 Safari、主屏 PWA 安装、冷启动和软件键盘验收；Android API 33 Emulator 完成 Chrome/系统 WebView、软件键盘、可访问性树和横向溢出验收。
- Android Emulator 的旧版 Chrome 103 WebAPK launcher 安装不作为独立门槛；安装与升级语义由 5/5 built-dist PWA 测试覆盖，并在 QA 记录中保留该模拟器限制。
- 真实 iPhone/Android 作为发布后运营观察，不阻塞 UI V3 合并或发布。
- 真实 AI、搜索、路线、地图或其他 Provider 冒烟测试仍需当前任务明确授权；默认使用 fixture/mock，且不得用未授权真实调用替代自动化。
- 推送后同 SHA 的 GitHub CI、Cloudflare Pages Preview 和必要的安全诊断通过；合并后 Production 必须再次指向同一发布 SHA。

**退出条件**

- `design-qa.md` 对 Selected Target 的最终结果为 `passed`，没有 P0/P1/P2 视觉问题。
- 真实代码 Golden Screenshots 已替代生成图成为当前验收基线。
- 全量自动化和平台模拟器记录完整。
- `PROJECT_STATUS.md`、`README.md` 和 Beta 指南正确标注 Current/Target/Historical。

完整结果、Golden 更新规则、结构债和平台缺口以 [M6 完成度审计](UI_V3_M6_COMPLETION_AUDIT.md) 为准。

## 6. 共享组件到现有代码的映射

| Target 组件 | 当前落点 | 迁移要求 |
| --- | --- | --- |
| `AppScaffold` | `AppShell.tsx` | 唯一管理安全区、固定面和内容 inset |
| `PrimaryNavigation` | `BottomTabBar.tsx`、`routePresentation.ts` | 同一语义渲染 Tab/Rail/Sidebar |
| `ContextHeader` | App Shell 与页面私有 Header | 删除重复标题与页面私有固定头 |
| `TimelineRow` | Trip/Day 页面内部行程点 | 统一时间列、交通连接和状态 |
| `MapCanvas` / `TripStopSheet` | `DayMap.tsx`、`DayMapView.tsx` | 地图与唯一地点 Sheet 共享可用高度 |
| `DocumentPreviewRow` | `TicketThumbnail.tsx`、Documents/Tickets | 默认编辑式列表，真实预览和关键元数据 |
| `AiActionSheet` | `GlobalAiCommandBar.tsx` | 拆分输入、计划、确认、结果和重试状态 |
| `DisclosureRow` | `Collapsible.tsx`、Settings | 默认收起，短状态，无长摘要 |
| `FormSection` | Trip/Item forms | 基本信息、地点、更多设置三级披露 |

不得为了复用而建立与现有业务模型平行的第二套对象类型。共享组件接收页面 ViewModel，不直接读取数据库或调用 Provider。

## 7. PR 与分支策略

推荐拆分为 6 个可独立审查的实现 PR：

| PR | 建议分支 | 内容 |
| --- | --- | --- |
| 1 | `feature/ui-v3-product-shell` | M0 基线整理 + M1 Shell/共享组件 |
| 2 | `feature/ui-v3-core-journey` | M2 核心纵向流程 |
| 3 | `feature/ui-v3-itinerary-map` | M3 行程、地图、地点与表单 |
| 4 | `feature/ui-v3-ai-search` | M4 搜索与 AI 动作层 |
| 5 | `feature/ui-v3-tools-settings` | M5 费用、同行与设置 |
| 6 | `feature/ui-v3-release-qualification` | M6 Golden、全量 E2E、平台模拟器与发布证据 |

执行规则：

- 当前分支先整理，不从脏工作区切分支或拉取。
- 每个 PR 只 stage 明确文件，禁止 `git add .`。
- 每个 PR 合并后，下一个分支从最新 `main` 创建。
- 不把数据库、Provider、同步、存储或 AI 隐私合同混入 UI PR。
- 每个 PR 必须包含对应单测、E2E、截图和文档状态更新。
- 常规合并使用 PR 和 required checks；只有用户明确要求时才直接推送 `main`。

## 8. 每阶段质量门

每个实现阶段只有同时满足以下条件才算完成：

1. 用户路径可操作，不存在仅有视觉没有行为的核心控件。
2. 同状态实现截图与 Selected Target 的层级、密度、色彩和空间重心一致。
3. 没有横向溢出、固定层遮挡、键盘遮挡或重复导航。
4. 新代码有对应单测或 E2E；高风险共享行为有跨页面回归测试。
5. `typecheck`、`lint`、`test:unit`、`build` 和相关 E2E 通过。
6. `git diff --check` 通过，没有无关格式化、元数据或生成物。
7. Current、Target、Historical 状态准确，没有把生成稿描述为已上线能力。

## 9. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| Shell 改动影响所有路由 | M1 单独合并；建立 route matrix 和固定区域 E2E | 恢复上一版 Shell，页面迁移提交保持独立 |
| 大页面拆分引入状态回归 | 先提取纯 ViewModel，再替换展示；保持现有业务函数 | 路由级回退到旧页面组件 |
| 地图动态内容导致截图不稳定 | fixture + Canvas/Marker/控件结构断言 | Golden 排除动态瓦片，只保留结构门槛 |
| 票据预览失败或内容敏感 | 使用测试附件和脱敏 fixture；真实文件只作授权冒烟 | 降级为真实文件行，不伪造预览 |
| AI UI 迁移破坏确认门控 | Action Gateway 合同测试先行；UI 不自行执行写入 | 保留旧执行适配器，只替换展示层 |
| 全量改版难以评审 | 每阶段单独 PR、同状态对比和退出条件 | 停在最近一个已通过阶段，不合并后续页面 |

## 10. Definition Of Done

UI V3 只有满足以下全部条件才能从 Target 改为 Current：

- 32 个设计页面与关键状态都由共享组件覆盖，不存在明显的旧壳层孤岛。
- “导入材料 → 出发前今日 → 旅行中下一步 → 打开票据”真实闭环通过。
- 四项导航、AI Action Sheet、资料编辑式列表和阶段化 Today 全部上线。
- Hash 深链接、返回上下文、PWA 升级和历史数据迁移未回归。
- 所有固定视口、状态、无障碍、性能和自动化门槛通过。
- iOS Simulator、Android Emulator 与 built-dist PWA 生命周期验收完成。
- 同 SHA 的 CI 和生产部署成功。
- 真实代码 Golden Screenshots 成为新的视觉权威，生成稿只保留为 Historical 设计证据。

## 11. 发布后动作

1. 将实体机性能、文件选择和真实网络差异作为 Beta 运营观察，不回退模拟器发布标准。
2. 按 [Roadmap V5](ROADMAP_V5.md) 进入 Realtime Cloud Core，不在 UI V3 收尾中改写同步或 Provider 合同。
3. 后续共享 UI 改动继续运行固定视口、Golden、完整 E2E 和 PWA 升级门槛。
