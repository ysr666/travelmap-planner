# TripMap UI V3 产品质感 Design QA

更新时间：2026-08-10

状态：**Production Current; passed**

发布代码：`177f78f`（`main`，PR #34）；候选分支头：`f20cb90`

## 1. 结论

- **视觉：passed。** Selected Target 的出发前今日、旅行中今日、行程和资料已按同一 `390x844` 数据语义并排审查，没有未关闭的 Visual P0/P1/P2。
- **产品流程：passed。** 真实对象、受控媒体、有来源事实、票据直达、地点补全、地图和 AI 一次确认共同工作；错误态保持短、明确且不写入。
- **浏览器自动化：passed。** 215 个单测文件、1730 个单测、194 个串行 E2E、5 个独立 PWA 升级场景、Golden、Axe、五视口和素材门禁全部通过。
- **模拟器：passed。** iPhone 16 / iOS 26.5 主屏 PWA 与 Android API 33 Chrome/WebView 完成发布级检查；实体机按项目决定不作为门槛。
- **远端发布：passed。** 候选分支与合并后的 `main` 均通过 GitHub required checks；同 SHA 的 Cloudflare Preview 与 Production 部署均为 Active，Supabase 与 Provider 基础设施只读诊断已完成。

## 2. 视觉权威

规范优先级：

1. `docs/PRODUCT_POSITIONING.md`
2. `docs/DESIGN.md` 与 `docs/UI_REFACTOR_V3.md`
3. `docs/DESIGN_SYSTEM.md` 的语义 Token 与交互合同
4. `docs/UI_V3_PRODUCT_FIDELITY_BASELINE.md` 的逐项差异收据
5. 固定 fixture 渲染的真实 React 组件和 Golden
6. Selected Target 生成稿

Selected Target：

`/Users/ysradmin/.codex/generated_images/019f408f-a034-7262-a9d4-36f429207ee6/exec-084f9e07-16d8-463e-99ac-fc66c2aca5ae.png`

目标组合仍是：第一套左上角的出发前 Today 信息结构、第二套整体旅行对象视觉语言、第三套资料编辑式列表。生成稿定义层级、密度、色彩和空间重心；真实地图、照片、票面、Provider 事实和系统字体不要求复制生成稿像素。

## 3. 同状态比对

左侧为 Selected Target，右侧为真实实现；以下是本机运行产物，不提交仓库：

- `output/playwright/product-fidelity-design-qa/today-predeparture-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/today-active-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/itinerary-side-by-side.png`
- `output/playwright/product-fidelity-design-qa/documents-side-by-side.png`

### 出发前今日

- 首屏按“上海 → 伦敦”、出发日期、倒计时、唯一阻塞项、航班、住宿、保险和必要天气排列。
- 航司/保险品牌、两地时间、机场、酒店日期、保单号和来源状态来自结构化对象，不由页面猜测。
- 没有默认地图、大块建议、重复摘要或第二个主要操作。

### 旅行中今日

- 下一站真实媒体、日期/城市、倒计时、交通、入场时间和精确票据形成一个 Hero；唯一主要动作是开始导航。
- 真实 MapLibre Canvas、道路几何、编号 Marker、活动路段和单一地点 Sheet 接续在 Hero 后。
- 没有常驻 AI 文案、假地点图、路线直线冒充道路或多个底部交互层。

### 行程

- 紧凑日期条、日程/地图切换和连续时间线立即开始。
- 地点、餐厅、景点与铁路使用对应媒体和结构化票据状态；交通连接保持轻量。
- 排序、编辑和删除留在工具栏或更多菜单，不把每个行程点做成厚卡片。

### 资料

- 页面使用单列编辑式列表，优先真实票面、PDF 首页或受控对象媒体；品牌和文件类型只作为有序降级。
- 每行显示名称、类别、日期/时间、关键字段和关联状态，点击直接预览。
- 分类、搜索、筛选和新增保持紧凑；长无空格文件名与 `200%` 文本不会挤掉操作。

## 4. 关键产品合同

- 移动主导航固定为 `今日 | 行程 | 资料 | 我的`；AI 和搜索是按需命令。
- AI 关闭时不占空间；导航成功后关闭。只读动作可直接完成，写入计划只有一次最终确认。
- 地点补全成功候选先预览再写入；invalid、quota、Provider disabled、歧义和 stale plan 均不写入。
- 精确票据一次点击打开；宽泛目标进入当前旅行的资料列表，不返回只有名称的文本答案。
- RealtimeFact 必须有来源、观察时间与有效期；过期或无来源事实不显示成“当前”。
- 远程媒体只接受登记 Provider 和受控引用；票据 Blob、Token、Provider 密钥和完整数据库不进入 AI/媒体请求。
- 同一时刻只显示一个展开的底部交互层；AI、地点 Sheet、sticky action 与主导航不形成可见叠层。

## 5. 自动化证据

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed，无 warning |
| `npm run test:unit` | passed，215 文件 / 1730 测试 |
| `npm run build` | passed |
| Bundle budget | entry 469.4 KiB；initial 853.9 KiB；gzip 246.0 KiB；8 startup chunks |
| PWA precache | 2449.9 KiB / 121 项，低于 2500 KiB 门槛 |
| `npm run check:fidelity-assets` | passed，11 项受控素材 |
| Product fidelity Golden | passed，固定候选基线 |
| `npm run test:e2e:serial` | passed，194/194，约 7.3 分钟 |
| `npm run test:e2e:pwa-upgrade` | passed，5/5，约 50.2 秒 |
| `git diff --check` | passed |

覆盖包括：`320x568`、`390x844`、`430x932`、`768x1024`、`1440x900`；浅/深色、长内容、`200%` 文本、Reduced Motion、软件键盘、触控尺寸、严重/关键 Axe、媒体 loading/error/expired/offline/reduced-data、CLS、地图 Canvas 像素和零意外 Provider 请求。

## 6. 平台模拟器

### iPhone

- iPhone 16 / iOS 26.5 Simulator 从 Safari 打开候选源码的 QA build 并安装 `旅图` 到主屏；该 build 仅启用 E2E 登录旁路，不包含真实 Provider 调用。
- 独立 PWA 启动时没有 Safari 控件，App Shell 覆盖完整可见区域，底栏和安全区正确，无横向溢出。
- 证据：`output/simulator-p8/ios-pwa-launch.png`、`output/simulator-p8/ios-current-after-viewport-fix.png`。

### Android

- Android API 33 Emulator 通过系统代理验证 Chrome/WebView；WebView QA 壳加载同一 built app，不调用真实 Provider。
- Today、行程、资料、我的、真实 MapLibre 地图、道路/Marker、单一地点 Sheet 和 AI Action Sheet 均通过视觉与几何检查。
- 软件键盘打开后 `innerHeight`、`visualViewport`、`#root` 与 `.app-viewport` 同步缩至约 `554px`；AI 输入和发送按钮仍可见，页面 `scrollWidth === clientWidth === 411`。
- CDP Accessibility 树确认四项主导航、AI 对话框、上下文切换、关闭、文本框和发送按钮均有可访问名称；可见交互控件没有横向越界。
- 证据：`output/simulator-p8/android-webview-map.png`、`android-webview-map-sheet.png`、`android-webview-documents.png`、`android-webview-settings.png`、`android-webview-ai-keyboard.png`。

### 兼容修复

Android WebView 103 不支持 `svh/dvh`。首次正式产物检查发现 Lightning CSS 合并相邻声明后只保留动态视口单位，导致 `#root` 和 App Shell 只有 `538px` 高，而可见视口为约 `866px`。修复后：

- `100vh` 保持在基础规则，`svh/dvh` 放入独立 `@supports` 渐进增强块。
- 正式产物的根节点、App Shell 和底栏底边均为约 `866.29px`。
- `scripts/check-bundle-budget.mjs` 会直接检查 emitted CSS，防止压缩再次删除旧内核回退。

## 7. 已接受差异

- iOS、Android 与桌面的系统字体栅格、原生安全区和键盘像素不同。
- 动态地图瓦片、POI 标签和用户位置由真实运行环境决定；道路几何与交互语义必须存在。
- Provider/受控素材可使用与生成稿不同但语义正确的对象照片；媒体比例、裁切与层级必须一致。
- 无合法品牌资源时使用通用 Lucide 图标和名称；无来源或已过期事实隐藏或显示短过期状态。
- `200%` 文本允许纵向增长与换行，不允许横向滚动、遮挡和操作消失。

## 8. 发布收据

- PR：[#34](https://github.com/ysr666/travelmap-planner/pull/34)，候选 SHA `f20cb90`。
- GitHub 候选检查：run `31330053266`，Build、Lint、Type Check、Unit、E2E 与 Cloudflare Pages 全部通过。
- Cloudflare Preview：deployment `b356f0ad-e003-425c-998d-d71f44cb4d64`，来源 `f20cb90`，状态 Active。
- 合并：`main` merge SHA `177f78f`；GitHub run `31330366741` 的 Build、Lint、Type Check、Unit 与 E2E 全部通过。
- Cloudflare Production：deployment `b0766ac0-baff-47f0-9899-ea324b845261`，来源 `177f78f`，状态 Active。
- Supabase：本轮没有 schema 变更；16 项既有 migration 可见，过去 24 小时 Auth/Edge Function 日志无新增错误。Advisor 仅保留既有配置项：泄露密码保护未开启、`cloud_ticket_blobs` 存在多个 permissive SELECT policy，以及若干未使用索引；均非本轮代码引入。
- Cloudflare D1：发布诊断发现 `0003_add_weather_provider_group.sql` 因 Wrangler 未声明迁移目录而未执行。已补齐 `migrations_dir`、移除 D1 不接受的显式事务语句并加入构建门禁；生产 migration 已成功应用，`weather` 控制记录启用，三张 Provider 表均允许 `weather`，当前无待执行 migration，既有 usage/alert 数据未受影响。
- 真实 Provider smoke：未授权，本轮未执行；mock、合同和边界测试通过，没有真实 AI、搜索、路线、天气或媒体请求。
