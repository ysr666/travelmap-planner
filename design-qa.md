# TripMap UI V3 Design QA

更新时间：2026-08-05

状态：**Candidate implementation acceptance**

本页记录 2026-08-05 `feature/ui-v3-product-shell` 的真实代码验收。它替代 2026-07-30 地图主导方向的验收结论，但不把尚未合并、部署或完成实体机验证的候选版本写成生产 Current。

## 1. 结论

- **视觉实现：passed。** Selected Target 的四个核心状态已经用同状态并排图审查，没有待修复的 P0、P1 或 P2 视觉问题。
- **浏览器产品验收：passed。** 核心流程、固定视口、长内容、200% 文本、软件键盘、浅色/深色、无障碍和横向溢出门槛已由真实组件与 E2E 覆盖。
- **发布资格：pending。** 真实 iPhone 当前离线，Android 未连接；同 SHA GitHub CI 和 Cloudflare Pages 只能在候选提交推送后核验。

UI V3 在合并和发布前仍称为 **Candidate**。实体机与远端门槛通过后，才可把本页最终状态和项目文档改为 Current。

## 2. 视觉权威

规范优先级：

1. `docs/PRODUCT_POSITIONING.md`
2. `docs/UI_REFACTOR_V3.md`
3. `docs/DESIGN_SYSTEM.md` 与语义 Token
4. 固定 fixture 渲染的真实 React 组件和 Golden Screenshots
5. Selected Target 生成稿

Selected Target：

`/Users/ysradmin/.codex/generated_images/019f408f-a034-7262-a9d4-36f429207ee6/exec-084f9e07-16d8-463e-99ac-fc66c2aca5ae.png`

目标组合保持不变：出发前首页采用第一套左上角的信息组织，整体采用第二套“随身旅夹”视觉语言，资料采用第三套编辑式预览列表。生成稿只决定层级、密度、色彩和空间重心，不负责真实地图道路、票据内容、Provider 事实或数据模型。

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
- `npm run test:unit`：passed，`190` 个文件、`1576` 个测试。
- `npm run build`：passed。
- Bundle budget：入口 `468.2 KiB`；初始 JS `852.5 KiB`；初始 gzip `245.5 KiB`；启动 chunk `8` 个。
- PWA precache：`2327.3 KiB / 114` 项，仍低于 `2500 KiB` 门槛。
- V3 Golden/视觉流程：`12 / 12` passed，覆盖 `320x568`、`390x844`、`430x932`、`768x1024`、`1440x900`。
- `npm run test:e2e:serial`：`173 / 173` passed，串行耗时约 `6.2m`。
- `npm run test:e2e:pwa-upgrade`：`5 / 5` passed。
- `git diff --check`：passed。

## 7. 发布门槛

仍需完成：

1. 真实 iPhone Safari/PWA：安装、冷启动、软件键盘、地图、票据、弱网和升级。
2. 真实 Android Chrome/PWA：安装、冷启动、软件键盘、地图、票据、弱网和升级。
3. 提交并推送候选分支后，核验同 SHA GitHub required checks。
4. 合并后核验同 SHA Cloudflare Pages production deployment。
5. 将实体机和远端结果补录到 `docs/BETA_QA_RECORD.md` 与 `docs/LIMITED_BETA_READINESS.md`。

当前设备探测只发现一台离线 iPhone，`adb devices -l` 没有 Android 设备。模拟器和桌面移动视口可以补充回归，但不能替代以上实体机发布证据。

## 8. 历史边界

2026-07-30 的地图主导 `2 + 3` 方向、旧五项导航、`收件箱`一级入口、票据双列画廊和常驻 AI 输入均为 Historical。相关旧截图只证明当时实现，不再是 UI V3 当前视觉权威。

当前最终结果：**visual and browser acceptance passed; release qualification pending physical devices and same-SHA remote checks.**
