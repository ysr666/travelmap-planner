# TripMap 时区与日期语义审计

更新时间：2026-06-14

## 当前行为总结

安全的部分：

- Trip 的 `startDate` / `endDate`、Day 的 `date` 仍以 `YYYY-MM-DD` plain date 字符串保存，不表示 UTC 日期，也不表示设备本地日期。
- 行程点的 `startTime` / `endTime` 仍以 `HH:mm` local wall-clock time 字符串保存。
- `createdAt` / `updatedAt`、导出时间、cloud metadata、route cache 时间继续是绝对系统时间。
- `src/lib/plainDate.ts` 统一处理 plain travel date，拒绝溢出日期、非补零日期和完整 ISO datetime。
- `src/lib/dates.ts` 保留原有导出 API，但内部使用 plain-date helper，避免 `dayjs(date)` 或本地 `new Date(...)` 解析旅行日期。
- Trip / Day / Item 已有可选 IANA timezone 字段，不依赖固定 UTC offset。
- Trip / Day / Shared Trip / Trip Operations / Live Mode 的“今天”和当前时间语义已走 timezone helper，而不是直接使用设备日期。
- AI import 和 existing-trip import 可接收 timezone 字段；无效 timezone 会被忽略并产生 warning，不会静默写入。

已实现的 timezone 字段：

- `Trip.timeZone`
- `Trip.timeZoneSource`
- `Day.timeZone`
- `Day.timeZoneSource`
- `ItineraryItem.startTimeZone`
- `ItineraryItem.endDate`
- `ItineraryItem.endTimeZone`

已实现的 UI / helper：

- Trip 新建 / 编辑页可设置默认时区；目的地变化可通过 provider proxy place lookup 推断，未配置或失败时回退设备时区。
- Day View 更多菜单可手动覆盖当天时区；默认继承 Trip timezone。
- Item 表单在 flight / train / other 或已有跨时区字段时显示跨时区时间字段。
- `resolveTripTimeZone`、`resolveDayTimeZone`、`resolveItemTimeRange` 负责 Trip / Day / Item 的继承和 instant 推导。
- `lookupTimeZoneFromCoordinates` 使用本地 `tz-lookup` 包从坐标推 IANA timezone，不需要远程调用。

## 字段分类

plain travel date fields：

- `Trip.startDate`
- `Trip.endDate`
- `Day.date`
- `ItineraryItem.endDate`
- AI import: `trip.startDate`、`trip.endDate`、`days[].date`、`items[].endDate`、`tickets[].bindTo.date`

plain local wall-clock time fields：

- `ItineraryItem.startTime`
- `ItineraryItem.endTime`
- AI import: `items[].startTime`、`items[].endTime`

IANA timezone fields：

- `Trip.timeZone`
- `Day.timeZone`
- `ItineraryItem.startTimeZone`
- `ItineraryItem.endTimeZone`

timezone source fields：

- `Trip.timeZoneSource`
- `Day.timeZoneSource`

absolute system timestamp fields：

- `Trip.createdAt`、`Trip.updatedAt`
- `ItineraryItem.createdAt`、`ItineraryItem.updatedAt`
- `TicketMeta.createdAt`、`TicketMeta.updatedAt`
- zip backup `manifest.exportedAt`
- cloud snapshot `exportedAt`
- Supabase `created_at`、`updated_at`、`exported_at`
- route cache `createdAt`、`updatedAt`、`lastUsedAt`

## 当前推荐模型

- Travel date: `YYYY-MM-DD` plain date，只表示旅行上下文中的日期。
- Itinerary time: `HH:mm` local wall-clock time，只表示对应 Day / Item timezone 下的墙上时间。
- Trip timezone: 可选 IANA timezone，作为整段旅行默认值。
- Day timezone: 默认继承 Trip timezone；跨国家旅行时可按 Day 覆盖。
- Item timezone: 默认继承 Day timezone；跨时区交通可设置 departure / arrival timezone 和 arrival date。
- `updatedAt` / `exportedAt`: 继续使用绝对系统时间，用于排序、冲突检查、同步版本判断。

## 当前边界

- 不自动推断或迁移历史旅行的 timezone；旧数据缺失 timezone 时继续回退设备时区。
- 地点服务未配置、失败或没有坐标时，Trip timezone inference 只回退设备时区并提示，不阻塞用户手动设置。
- Item `startDate` 仍由所属 Day 的 `date` 表达；跨日到达通过 `ItineraryItem.endDate` 表达。
- 跨时区表单只在 long-distance transport 或已有 timezone 字段时展开，不把所有本地景点表单复杂化。
- Route cache 仍按 dayId、坐标和时间字符串等现有签名工作；本阶段不改 route cache 合同。
- AI draft generation / repair 不联网搜索；timezone 字段只是结构化输入的一部分，不代表实时营业时间、航班状态或交通状态。

## Phase 12F-mini 修正

- 补 `timeZoneInference` mock 单测，确保空查询、未配置 provider proxy、mock 坐标推断和 provider 失败 fallback 都不触发真实远程调用。
- 收紧 `ItineraryItemForm` 跨时区提交校验：到达日期不能早于当前 Day 日期。
- 更新本文档，避免后续把已落地的 Trip / Day / Item timezone foundation 误判为未开始。

## 未来编码硬规则

- 不要把 `YYYY-MM-DD` 当浏览器本地 `Date` 随便解析。
- 不要把旅行日期存成浏览器本地 ISO timestamp。
- 不要让设备当前时区改变已声明 timezone 的 Trip / Day 旅行日期。
- 旅行日期和行程时间继续以字符串表达本地墙上时间。
- 需要时区时使用 IANA timezone ID，不使用固定 UTC offset 作为长期模型。
- 绝对系统时间和旅行本地日期必须分开命名、分开处理。
- 自动推断 timezone 只能作为可见、可覆盖的建议；不能把推断结果伪装成用户确认过的事实。

## 风险列表

High：

- 未来 AI import 或 route generation 如果静默把完整 ISO datetime 截断为 `YYYY-MM-DD` / `HH:mm`，会改变跨时区航班和夜车语义。相关文件：`src/lib/tripPlanImport.ts`、AI schema 文档。
- 新地图、路线或内容 enrich 功能如果把实时营业时间、ETA、航班状态和 timezone 混成模型常识，会破坏 source-bearing / confirmation boundary。

Medium：

- 旧旅行没有 timezone 字段时仍回退设备时区；用户跨时区打开 PWA 时，“今天”可能不是目的地当天。
- Trip destination 自动推断只取第一个地点候选，适合默认建议，不适合做不可逆数据迁移。
- Day timezone override 已有 UI，但还没有面向多国家旅行的完整引导、批量设置或冲突提示。

Low：

- `buildTripBackupFileName` 和导入副本标题后缀使用设备本地时间生成文件名 / 标题。这是系统操作时间，不是旅行日期，当前可接受。
- Cloud snapshot prompt 时间使用固定 `Asia/Shanghai` 展示版本时间。这是系统版本提示，不影响旅行日期。
- route cache signature 仍不包含 timezone；当前路线缓存按 dayId 和坐标为主，后续如果把 timezone 纳入 ETA 语义再单独设计。

## 推荐下一步

- Phase 13A Trip Home 地图概览可以继续推进，但应按现有 Day 顺序和 plain date 字符串展示，避免新增未确认的“当前旅行日”自动推断。
- 为 Trip / Day timezone UI 增加更完整的产品 copy 和批量设置，可作为后续 UX phase。
- AI import 如需支持完整 ISO datetime with timezone，应走显式预览映射，不得静默截断。
