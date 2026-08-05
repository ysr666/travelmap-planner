# TripMap UI V3 Design QA

更新时间：2026-08-05

状态：**Candidate implementation acceptance**

候选代码基线：`3a9fb8c`

本页记录 2026-08-05 `feature/ui-v3-selected-target` 的真实代码验收。它替代 2026-07-30 地图主导方向的验收结论，但不把尚未合并、部署或完成实体机验证的候选版本写成生产 Current。逐项完成度、Golden 合同和发布顺序见 [M6 完成度审计](docs/UI_V3_M6_COMPLETION_AUDIT.md)。

## 1. 结论

- **视觉实现：passed。** Selected Target 的四个核心状态已经用同状态并排图审查，没有待修复的 P0、P1 或 P2 视觉问题。
- **浏览器产品验收：passed。** 核心流程、固定视口、长内容、200% 文本、软件键盘、Reduced Motion、浅色/深色、无障碍和横向溢出门槛已由真实组件与 E2E 覆盖。
- **已推送结构基线远端检查：passed。** `73fe5af` 的 GitHub required checks 与 Cloudflare Pages Preview 均按同一 SHA 通过；包含 S2-S3 的最终分支头需在推送后复验。
- **结构验收：passed。** S1-S3 已把设置、票据、Trip、Day、Item、Global AI 和 AI Draft 拆成控制、状态、ViewModel 与展示边界，Golden 和保护合同未回归。
- **发布资格：pending。** 真实 iPhone 当前离线，Android 未连接；实体机与合并后的 Cloudflare Pages Production 尚未完成。

UI V3 在合并和发布前仍称为 **Candidate**。实体机与远端门槛通过后，才可把本页最终状态和项目文档改为 Current。

## 2. 视觉权威

规范优先级：

1. `docs/PRODUCT_POSITIONING.md`
2. `docs/UI_REFACTOR_V3.md`
3. `docs/DESIGN_SYSTEM.md` 与语义 Token
4. 固定 fixture 渲染的真实 React 组件和可执行 Golden 回归
5. Selected Target 生成稿

Selected Target：

`/Users/ysradmin/.codex/generated_images/019f408f-a034-7262-a9d4-36f429207ee6/exec-084f9e07-16d8-463e-99ac-fc66c2aca5ae.png`

目标组合保持不变：出发前首页采用第一套左上角的信息组织，整体采用第二套“随身旅夹”视觉语言，资料采用第三套编辑式预览列表。生成稿只决定层级、密度、色彩和空间重心，不负责真实地图道路、票据内容、Provider 事实或数据模型。

`e2e/ui-v3-golden-regression.spec.ts` 会从固定 commit/tree/lock 构建批准基线，并与当前真实构建逐像素比较出发前今日、行程、资料和地点详情。差异比例必须 `<= 0.005`；成功时不提交截图，失败时才附加当前图和基线图。完整更新规则见 M6 审计。

## 3. 同状态比对

全部比对统一为 `390 x 844`，左侧为 Selected Target，右侧为真实实现：

- `output/playwright/ui-v3-selected-comparisons/predeparture-reference-vs-implementation.png`
- `output/playwright/ui-v3-selected-comparisons/active-reference-vs-implementation.png`
- `output/playwright/ui-v3-selected-comparisons/trip-reference-vs-implementation.png`
- `output/playwright/ui-v3-selected-comparisons/documents-reference-vs-implementation.png`

### 出发前今日

- 实现保留倒计时、唯一阻塞项、机票/住宿/保险和单一主操作。
- 删除生成稿中无法由旅行事实可靠推导的天气和装饰图片，不用虚构内容换取像素相似。
- 已就绪对象使用线性列表，不恢复大块建议、统计卡或默认地图。

### 旅行中今日

- 下一站、出发倒计时、交通、票据和导航在首屏一次扫清。
- 地图位于操作对象之后，保持真实 Canvas、Marker 和路线语义；缺少 Provider 道路几何时使用明确的点序列降级，不伪造道路。
- 生成稿中的城堡照片不是用户数据，未复制进产品 fixture。

### 行程

- `日程 | 地图` 是唯一视图切换；资料、费用和工具不再形成重复标签栏。
- 日期条、连续时间轴、交通连接和添加入口保持高信息量，但没有独立厚卡片。
- 真实标题、地址和交通数据优先于生成稿图片；页面在 `320px` 和长英文下仍不横向溢出。

### 资料

- 默认是左侧真实预览、右侧名称与关键元数据的编辑式列表，不是双列画廊或文件类型头图。
- 图片、PDF 首页和外部链接分别使用真实可用预览；不把护照、二维码或订单图片伪造进 fixture。
- 分类、来源与导入、筛选和新增保持可操作，长无空格文件名最多两行且不撑宽页面。

## 4. 页面覆盖

| 页面组 | 已验收状态 |
| --- | --- |
| 今日 | 无旅行、出发前、旅行中、旅行后、长内容、200% 文本 |
| 行程 | 紧凑日期条、连续时间轴、日程/地图切换、跨日期上下文 |
| 地图 | 动态 Canvas、Marker、路线、当前位置、单一地点 Sheet、降级状态 |
| 地点 | 导航、票据、来源确认、长名称/地址、返回上下文 |
| 资料 | 编辑式预览列表、空状态、预览、编辑、绑定、待整理、来源与导入 |
| AI 与搜索 | 上下文搜索、Action Sheet、计划、一次确认、部分失败和失败项重试 |
| 表单 | 旅行与行程点新建/编辑、渐进披露、软件键盘、sticky save |
| 低频页面 | 费用、费用详情、同行、AI Draft、我的及四组二级设置 |

## 5. 交互合同

- 移动主导航固定为 `今日 | 行程 | 资料 | 我的`；AI 和搜索是 Toolbar/内容命令。
- AI 关闭时不占内容空间；导航成功后自动关闭。
- 只读动作可直接完成；写入计划只保留一次最终确认。
- 一键修复从首页直接生成统一预览，成功步骤不因失败项重试而重复执行。
- 同一时刻只有一个固定底部交互面展开；AI、地点 Sheet、sticky action 和主导航不叠加。
- 设置一级只有四组，技术项进入二级并默认收起。
- 所有生成稿之外的真实地图、票据、文件和地点事实仍服从数据来源与隐私边界。

## 6. 自动化证据

截至本页写入时：

- `npm run typecheck`：passed，覆盖应用、Provider runtime 和 Travel Inbox Worker。
- `npm run lint`：passed，无 warning。
- `npm run test:unit`：passed，`191` 个文件、`1578` 个测试。
- `npm run build`：passed。
- Bundle budget：入口 `468.2 KiB`；初始 JS `852.4 KiB`；初始 gzip `245.5 KiB`；启动 chunk `8` 个。
- PWA precache：`2337.3 KiB / 114` 项，仍低于 `2500 KiB` 门槛。
- V3 Golden/视觉流程：passed；新增固定 Git 基线的四页面逐像素回归，`maxDiffPixelRatio <= 0.005`，并继续覆盖 `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900`。
- Reduced Motion：真实浏览器 media emulation 与全局 CSS 合同测试均 passed。
- S3 聚焦验证：AI Draft 单测 `118 / 118`，AI Draft/表单/Golden E2E `47 / 47` passed。
- `npm run test:e2e:serial`：`175 / 175` passed，串行耗时约 `6.6m`。
- `npm run test:e2e:pwa-upgrade`：`5 / 5` passed。
- `git diff --check`：passed。
- GitHub Actions run `30992807064`：同 SHA `73fe5af` 的 `Lint`、`Type Check`、`Unit Tests`、`Build`、`E2E Tests` 全部 passed；E2E job 用时约 `5m09s`。
- Cloudflare Pages Preview deployment `4e2542bd-19b8-442d-90b8-8f1697dad436`：同 SHA `73fe5af` 为 Active。包含 S2-S3 的最终分支头和 Production 仍待核验。

## 7. 模拟器补充验收

模拟器只用于提前发现平台兼容问题，不替代实体机发布证据：

- iPhone 16 / iOS 26.5 Simulator 的 Safari 已验证无旅行、旅行后 Today、行程时间轴、地图、资料、我的和 AI Action Sheet；软件键盘打开时输入区仍位于可见区域内，页面未横向溢出。
- Android API 33 Emulator 使用临时本地 WebView 壳加载同一 PWA，验证 Today、行程、地图 Canvas、资料、我的和 AI Action Sheet；所有页面满足 `scrollWidth === clientWidth`。
- Android WebView 103 不支持 `dvh/svh`，首次验收暴露 App Shell 只按内容高度展开的问题。`.app-viewport` 和 `#root` 已增加先声明的 `100vh` 回退，修复后 `867px` 可见视口、根节点、App Shell 和底部导航底边一致。
- 新增 CSS 合同单测，防止后续删除旧 Android 所需的 `vh` 回退或颠倒回退与动态视口声明顺序。
- 模拟器未验证主屏安装、真实设备性能、真实相机/文件选择、真实弱网切换或生产升级，因此发布资格仍为 pending。

## 8. 发布门槛

仍需完成：

1. 真实 iPhone Safari/PWA：安装、冷启动、软件键盘、地图、票据、弱网和升级。
2. 真实 Android Chrome/PWA：安装、冷启动、软件键盘、地图、票据、弱网和升级。
3. 若实体机修复改变候选代码，对准备合并的最终分支头重新核验 GitHub required checks 与 Cloudflare Pages Preview。
4. 合并后核验同 SHA Cloudflare Pages Production deployment。
5. 将实体机和生产部署结果补录到 `docs/BETA_QA_RECORD.md` 与 `docs/LIMITED_BETA_READINESS.md`。

当前设备探测只发现一台离线 iPhone，没有可用 Android 实体机。模拟器和桌面移动视口可以补充回归，但不能替代以上实体机发布证据。

## 9. 历史边界

2026-07-30 的地图主导 `2 + 3` 方向、旧五项导航、`收件箱`一级入口、票据双列画廊和常驻 AI 输入均为 Historical。相关旧截图只证明当时实现，不再是 UI V3 当前视觉权威。

当前最终结果：**visual, browser, and S1-S3 structural acceptance passed; final-head remote, physical-device, and production qualification remain pending.**
