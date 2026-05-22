# 旅图 TripMap 路线图 v4

本文档以 `/Users/ysradmin/Downloads/tripmap_future_design_direction_v4.md` 为新版产品方向来源，取代旧版“13 条产品修正”的整理方式。v4 的核心判断是：旅图接下来不是继续堆新功能，而是先修正前几轮 AI 改动带来的设计偏差。

## 核心纠偏

- 轻量化不是删内容。必要信息要保留，空壳 card、chip、分栏和无意义留白要删除。
- 独立页面不等于表单完成。新建 / 编辑页面需要继续做移动端布局、重叠、错误提示和键盘场景 QA。
- 路由拆分不等于交互完成。Trip Home / Day View / Item Detail 已拆开，但 Day View 仍未完成理想的“marker → 轻卡片 → Item Detail”地图交互。
- 继续保持 local-first。IndexedDB 是主数据源；Supabase 是单旅行云端保存，不是实时表同步。
- AI 和地图 API 只做辅助。AI 只建议，用户确认；API key 保存在本机；不缓存商业地图瓦片。

## 已完成基线

- Phase 11.6：地图 collapsed sheet 轻量化第一轮完成。
- Phase 12-pre-A/B：Home / Overview 有用标签恢复，Trip 更多菜单简化完成。
- Phase 12-pre-C：Trip / Item 新建编辑独立页面完成。
- Phase 12-pre-D：Trip Home / Day View 拆分实施计划完成。
- Phase 12-pre-E：共享数据加载与路由拆分铺垫完成。
- Phase 12-pre-F：Trip Home / Day View / Item Detail 导航回归检查完成。
- Phase 12A：自动云端保存基础完成。
- Phase 12B：PWA 启动云端保存检查完成。
- Phase 12C：冲突感知云端提示与操作链路完成。
- Phase 12E：视觉完整性纠偏与全页表单布局修复完成。

当前 canonical routes：

```text
#/home
#/trip?tripId=...
#/day?tripId=...&dayId=...&view=schedule|map
#/item?tripId=...&dayId=...&itemId=...
#/trip/new
#/trip/edit?tripId=...
#/item/new?tripId=...&dayId=...
#/item/edit?tripId=...&dayId=...&itemId=...
#/tickets
#/settings
```

## 不要误判为完成

- Trip Home 还不是完整旅行首页：全旅行地图概览和入口层级仍待做。
- Day View 还没有完成 marker-card interaction：当前仍以 sheet 为主，理想形态是 marker 触发轻卡片，再进入 Item Detail。
- Item Detail 仍需变成旅行现场查看页。
- Ticket Library 仍偏文件列表，还不是票据画廊。
- SwiftUI-like / iOS grouped list 风格还没有形成系统规范。
- 时区与日期语义审计待做：formatVersionTimestamp 等时间处理需复查。

## 后续路线图

### 1. Trip / Day / Item / Ticket UX completion

- Phase 12D：Home 与全局视觉纠偏。✅ 已完成。
- Phase 12E：Full-page form 布局修复与输入体验 QA。✅ 已完成。
- Phase 13A：Trip Home 地图概览与入口优化。Trip Home 成为真正旅行首页，而不是纯 overview。
- Phase 13B：Day View 地图点卡片交互。点击 marker 显示轻量卡片，点击卡片进入 Item Detail。
- Phase 14A：Item Detail 2.0。面向现场查看，突出时间、地点、交通、票据与外部导航。
- Phase 16A/B/C：Ticket Library 2.0、全屏票据预览器、Item Detail 票据紧凑展示。

### 2. SwiftUI-like design system

- Phase 15A：建立 `docs/DESIGN_SYSTEM.md`。
- 方向：iOS / SwiftUI grouped list、自然 section header、少卡片套卡片、少装饰 chip、按钮层级清楚。
- 目标：去 AI 味，让后续页面有一致的 spacing、radius、shadow、warning、sheet 和 form 规范。

### 3. Map UX

- Phase 17A：一键回到行程范围与用户位置。
- Phase 17B：marker / route line 缩放适配。
- Phase 17C：emoji / category marker foundation。
- 边界：不重写 MapLibre 生命周期，不破坏 route chip、route cache、ORS fallback、bottom sheet snap。

### 4. Map provider / cache

- Phase 18A：Map Provider Foundation。
- 建立底图、地点搜索、geocoding、routing provider 和 key management 分层。
- 可缓存用户确认坐标、placeId、简化候选和 route polyline；不缓存商业地图瓦片、Google 原始完整响应或大量自动预取数据。

### 5. Import route generation

- Phase 19A：Import Route Generation Queue。
- AI / zip 导入后只提示用户生成路线，不静默消耗 API。
- 生成结果写入本地 route cache，不进入 zip、Supabase 或 trip-plan schema。

### 6. AI-native PWA

- Phase 20A：AI Trip Generation Prompt / Schema。
- 先做 prompt 和 schema 文档，再考虑 API。
- AI 只生成 draft / 建议；地点、坐标、路线、交通时间和票据绑定必须由用户确认后写入。

## 长期边界

- 用户可见文案保持中文。
- 本地 IndexedDB 仍是主数据源。
- 旅行日期 / 时间语义遵循 `docs/TIMEZONE_AUDIT.md`；在 schema 设计完成前不要新增半套 timezone 字段。
- Supabase 是手动 / 自动单旅行云端保存，不是实时表同步。
- 启动云端保存检查会按“哪个更新用哪个”补偿：云端较新时原地恢复，本地较新时更新同一个云端保存；可能冲突时提示用户确认。
- 本地 zip 备份仍然重要。
- OpenRouteService / Google Maps 等 API key 只保存在本机或前端环境变量，不进入 IndexedDB、zip、Supabase 或 trip-plan。
- 不缓存商业地图瓦片，不修改 PWA service worker 做瓦片离线缓存。
- 390px 移动端宽度是基础验收线。
