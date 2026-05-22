# 旅图 TripMap 项目状态

更新时间：2026-05-17  
基线：Phase 12E 后，视觉完整性纠偏、全页表单布局修复、Trip Home 层级平衡和冲突感知提示均已完成。

## 当前定位

旅图是 local-first 出国旅行 PWA。核心数据保存在浏览器 IndexedDB；zip 和 Supabase 都是备份 / 恢复层，不替代本地数据源。

它不是订票软件、完整导航软件、实时同步产品或多人协作工具。AI 与地图服务只做辅助，最终写入仍应由用户确认。

## 当前 canonical routes

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

已完成的路由拆分语义：

- `#/trip`：Trip Home，旅行级总览与入口。
- `#/day`：Day View，承载 schedule / map 切换和当前 Day 的日程、地图。
- `#/item`：Item Detail 独立页面。
- `#/tickets`：票据库。
- `#/settings`：设置、备份、导入与 provider 配置。

## 已完成能力

- local-first PWA 与 IndexedDB 数据模型。
- Trip Home / Day View / Item Detail 路由拆分。
- Trip / Item 新建编辑独立页面。
- MapLibre 地图、OpenFreeMap 底图、编号 marker、直线连接。
- 手动道路路线 polyline，失败时回退直线。
- 本地路线缓存 `TripMapRouteCacheDB`，缓存自动加载、失效和清理。
- 地图 collapsed sheet 轻量化第一轮、route chip、route controls、公交近似提示。
- 票据 copy / reference / external 三模式。
- 完整 zip 备份导出 / 导入。
- AI trip-plan JSON / zip 导入，含 copy 附件和本地校验预览。
- Supabase 手动云端保存 / 原地恢复。
- 自动云端保存基础。
- PWA 启动云端保存检查。
- 冲突感知云端提示：本地较新、云端较新、可能冲突时只显示非阻塞提示。
- Playwright 移动端 E2E 与 Vitest 单元测试。

## 已完成阶段

- Phase 11.6：Map-first collapsed sheet redesign。
- Phase 12-pre-A/B：恢复有用标签、简化 Trip 更多菜单。
- Phase 12-pre-C：full-page create/edit routes。
- Phase 12-pre-D：Trip Home / Day View 拆分计划。
- Phase 12-pre-E：拆分准备与共享数据加载。
- Phase 12-pre-F：导航回归检查。
- Phase 12A：自动云端保存基础。
- Phase 12B：启动云端保存检查。
- Phase 12C：冲突感知云端提示。
- Phase 12E：视觉完整性纠偏与全页表单布局修复。

## 不要误判为完成

- Trip Home 还缺全旅行地图概览与更清晰入口。
- Day View 的 marker-card interaction 尚未完成：目标是点击 marker 出现轻量卡片，再进入 Item Detail。
- Item Detail 仍需变成旅行现场查看页，而不是普通信息页。
- Ticket Library 仍需从文件列表升级为票据画廊。
- SwiftUI-like / iOS grouped list 设计系统尚未沉淀。
- 时区与日期语义审计待做。

## 云端与同步状态

- Supabase 用于账号登录后的单旅行云端保存和恢复。
- 从当前版本开始，同一用户的同一 `trip.id` 使用稳定 `backupId`，手动上传会更新同一个云端保存，包含旅行结构化数据和 copy 模式票据附件。
- 自动云端保存默认关闭；开启后在本地 Trip / Day / Item / Ticket 变更成功后延迟更新同一个云端保存。
- 启动、恢复在线或登录变化时会比较本地版本信号与最新云端保存 metadata，并补偿本地更新、缺失云端保存或遗留上传中状态。
- 云端版本较新时会用云端保存原地更新同一 `trip.id` 的本地旅行；本地版本较新时会上传覆盖同一个云端保存；可能双向修改时要求用户确认。
- 删除本地旅行不会删除云端保存；删除云端保存必须走手动确认。
- 当前不是实时表同步，不做字段级合并、实时协作或云端删除同步。

## 数据与缓存边界

- IndexedDB 是主数据源。
- 旅行日期 / 时间语义见 `docs/TIMEZONE_AUDIT.md`：当前保持 `YYYY-MM-DD` plain date 与 `HH:mm` 本地墙上时间。
- 完整 zip 备份包含旅行、Day、Item、票据元数据和 copy 文件内容。
- 路线缓存只保存在当前浏览器本机，不进入 zip、Supabase 或 trip-plan。
- OpenRouteService / Google Maps key 不进入 IndexedDB、zip、Supabase 或 trip-plan。
- AI trip-plan 导入创建新旅行，不覆盖已有旅行。
- AI 只生成建议；用户必须核对地点、坐标、交通时间和票据。
- 不缓存商业地图瓦片，不通过 PWA service worker 做瓦片离线缓存。

## 下一步建议

优先执行 `docs/ROADMAP_V4.md` 中的后续阶段：

1. 时区与日期语义审计（Phase 12F）。
2. Trip Home 地图概览与入口优化（Phase 13A）。
3. Day View marker-card interaction（Phase 13B）。

在时区审计完成前，不建议继续推进 Map Provider、AI-native 或 Transit Hints 等新能力。
