# TripMap 时区与日期语义审计

更新时间：2026-06-23

## 当前行为总结

安全的部分：

- Trip 的 `startDate` / `endDate`、Day 的 `date`、行程点的 `startTime` / `endTime` 都以字符串保存，没有存成浏览器本地 `Date` 或 ISO timestamp。
- Trip / Day 已有可选 IANA `timeZone` 与 `timeZoneSource` 字段；Item 已有 `startTimeZone`、`endDate`、`endTimeZone`，用于表达跨日期 / 跨时区交通。
- Trip / Item 表单使用浏览器原生 `date` / `time` input，读取和写入的仍是 `YYYY-MM-DD` 与 `HH:mm` 字符串。
- AI trip-plan 导入要求日期为 `YYYY-MM-DD`，时间为 `HH:mm`，可导入并校验 Trip / Day / Item 级 IANA timezone 字段；无效 timezone 会被忽略并产生 warning。
- zip 归档和 Supabase cloud snapshot 会序列化现有记录，不会在导出 / 恢复时转换旅行日期。
- `createdAt` / `updatedAt` 是系统时间戳；`exportedAt`、cloud metadata 和 route cache 时间是绝对系统时间，可以继续使用 epoch milliseconds 或 ISO timestamp。

已有修正：

- `src/lib/plainDate.ts` 统一处理 plain travel date：严格校验 `YYYY-MM-DD`，拒绝溢出日期、非补零日期和完整 ISO datetime。
- `src/lib/dates.ts` 保留原有导出 API，但内部改为 plain-date helper，避免 `dayjs(date)` 或本地 `new Date(...)` 解析旅行日期。
- Home、Day View、Day Selector 的旅行日期展示不再依赖浏览器当前时区或 `Intl.DateTimeFormat` 的日期解析。
- AI import 的日期校验改为 strict plain-date 校验，`startTime` / `endTime` 继续只接受 `HH:mm`。
- `src/lib/timeSemantics.ts` 使用 Temporal 处理 plain date、IANA timezone、DST 不存在/重复墙上时间、绝对 instant 格式化和日期加减。
- `src/lib/timeZone.ts` 已集中处理 Trip → Day → Item timezone 继承、坐标 timezone lookup、跨时区 item start/end instant 解析和 chronology 判断。
- `src/hooks/useTripData.ts` 的 selected day 和 `src/lib/tripVisuals.ts` 的 Trip status 已按 Trip/Day timezone 判断，而不是直接使用设备本地日期。
- Cloud snapshot 版本时间展示会校验 timezone；无效 timezone fallback 到 UTC，不让同步提示崩溃。

仍有风险：

- 旧数据可能没有 `timeZone` 字段；当前会使用设备 timezone fallback，不会自动回填历史数据。
- Trip / Day / Item timezone 字段已存在，但还没有完整的迁移策略、用户教育和跨国家旅行高级 UI；历史数据的目的地时区不能自动推断。
- Day View 和 Item Detail 可以表达 Item 级到达日期/时区，但 Trip-level 日程仍以单个 Day 为主；复杂多段交通应优先使用资料中心交通订单。
- 未来地图路线、AI 导入、Trip Home 地图概览如果使用营业时间、ETA、航班延误或实时交通，仍必须区分 source-bearing provider facts 与本地 timezone 计算。

未知，需要未来验证：

- 用户到达目的地后打开 PWA，Trip Home 和 Day View 的“当前日”目前按 Day override / Trip timezone 判断；是否需要在 UI 中解释这个规则仍待验证。
- 多国家旅行中 Day 是否总是继承 Trip timezone，还是每个 Day 需要可选覆盖。
- AI 如果提供完整 ISO datetime with timezone，当前应拒绝或降级为用户确认流程；不能静默截断为日期 / 时间。

## 字段分类

plain travel date fields：

- `Trip.startDate`
- `Trip.endDate`
- `Day.date`
- AI import: `trip.startDate`、`trip.endDate`、`days[].date`、`tickets[].bindTo.date`

plain local wall-clock time fields：

- `ItineraryItem.startTime`
- `ItineraryItem.endTime`
- AI import: `items[].startTime`、`items[].endTime`

IANA timezone fields：

- `Trip.timeZone`
- `Day.timeZone`
- `ItineraryItem.startTimeZone`
- `ItineraryItem.endTimeZone`
- AI import: `trip.timeZone`、`days[].timeZone`、`items[].startTimeZone`、`items[].endTimeZone`

cross-date item fields：

- `ItineraryItem.endDate`
- AI import: `items[].endDate`

absolute system timestamp fields：

- `Trip.createdAt`、`Trip.updatedAt`
- `ItineraryItem.createdAt`、`ItineraryItem.updatedAt`
- `TicketMeta.createdAt`、`TicketMeta.updatedAt`
- zip backup `manifest.exportedAt`
- cloud snapshot `exportedAt`
- Supabase `created_at`、`updated_at`、`exported_at`
- route cache `createdAt`、`updatedAt`、`lastUsedAt`

existing timezone model：

- Trip default timezone: optional IANA timezone，例如 `Asia/Tokyo`、`Europe/London`。
- Day timezone: 默认继承 Trip timezone，可按 Day 覆盖。
- Item timezone: start 默认继承 Day timezone；end 默认继承 start timezone，可用 `endDate` / `endTimeZone` 表达跨日期或跨时区到达。
- Cross-timezone transport: Item 可表达一段出发/到达日期、时间、timezone；多段交通和敏感订单信息优先走 Travel Document Center 的 transport booking。

## 推荐模型

- Travel date: `YYYY-MM-DD` plain date，只表示旅行上下文中的日期，不表示 UTC 日期，也不表示设备本地日期。
- Itinerary time: `HH:mm` local wall-clock time，只表示目的地 / 当日上下文中的墙上时间。
- Trip default timezone: 可选 IANA timezone。缺失时使用设备 timezone fallback，但不得自动回填历史数据。
- Day timezone: 默认继承 Trip timezone；跨国家旅行时可按 Day 覆盖。
- Item timezone: start 默认继承 Day timezone；end 默认继承 start timezone；交通类 item 可显式设置到达日期和到达时区。
- Cross-timezone transport: 单段 item 可表达出发/到达两端日期、时间、timezone；复杂多段订单应使用资料中心交通订单。
- `updatedAt` / `exportedAt`: 继续使用绝对系统时间，用于排序、冲突检查、同步版本判断。

本阶段不做 schema / migration / backfill，原因：

- 当前记录形状已经包含基础 timezone 字段；本轮只对齐文档、测试和纯 helper。
- 现有历史数据可能不包含用户当时的目的地时区意图，自动补 timezone 会制造错误确定性。
- 多段交通、AI 完整 ISO datetime 映射、用户教育和跨国家高级 UI 仍需要独立设计。
- Phase 12 的目标是保证当前 plain-date / wall-clock / instant 语义不被设备时区或无效 timezone 静默破坏。

## 未来编码硬规则

- 不要把 `YYYY-MM-DD` 当浏览器本地 `Date` 随便解析。
- 不要把旅行日期存成浏览器本地 ISO timestamp。
- 不要让设备当前时区改变 Trip / Day 的旅行日期。
- 旅行日期和行程时间继续以字符串表达本地墙上时间。
- 需要时区时使用 IANA timezone ID，不使用固定 UTC offset 作为长期模型。
- 绝对系统时间和旅行本地日期必须分开命名、分开处理。
- 用户可见同步版本时间是系统版本时间，不是旅行当地日期；无效 timezone 必须 fallback，不能让 prompt 崩溃。

## 分阶段建议

- Phase 12F-1: 已完成 plain-date tests and helper hardening。
- Phase 12F-2: 已完成 Trip / Day / Item 基础 timezone 字段、导入保留、表单编辑和 Temporal helper foundation。
- Phase 12F-3: 已完成 selected-day、Trip status、Item start/end instant 和 cloud version timestamp 的 executable guardrails。
- 后续 12F-4: 设计 AI import 对完整 ISO datetime with timezone 的显式确认 / 映射，不允许静默截断。
- 后续 12F-5: 设计跨国家旅行的用户教育与高级 UI，只在真正需要时暴露 Day / Item timezone 差异。
- 后续 12F-6: 完善多段交通与 Item Detail 现场页的信息层级，优先复用 Travel Document Center transport booking。

## 风险列表

High：

- 未来 AI import 或 route generation 如果静默把完整 ISO datetime 截断为 `YYYY-MM-DD` / `HH:mm`，会改变跨时区航班和夜车语义。相关文件：`src/lib/tripPlanImport.ts`、未来 AI schema 文档。
- 未来 provider / AI 结果如果把营业时间、ETA、航班延误或实时交通当作本地 timezone 计算结果展示，会制造无来源事实。相关文件：provider proxy、AI edit、未来 Trip Home map overview。

Medium：

- 旧 Trip / Day 可能没有 timezone；fallback 到设备 timezone 仍可能与目的地不一致，但自动回填会更危险。相关文件：`src/lib/timeZone.ts`、`src/pages/TripFormPage.tsx`。
- Item 可以表达单段 arrival date/timezone，但复杂多段交通若硬塞进普通行程点仍会丢语义。相关字段：`ItineraryItem.startTime`、`ItineraryItem.endDate`、`ItineraryItem.endTimeZone`。
- Day override 规则已存在，但 UI 解释不足；跨国家旅行用户可能不理解为何“今天”按 Day timezone 变化。

Low：

- `buildTripBackupFileName` 和导入副本标题后缀使用设备本地时间生成文件名 / 标题。这是系统操作时间，不是旅行日期，当前可接受。相关文件：`src/lib/backup.ts`。
- Cloud snapshot prompt 时间是系统版本提示，不影响旅行日期；无效 timezone 已 fallback 到 UTC。相关文件：`src/lib/cloudSnapshotCheck.ts`。
- route cache signature 包含 `startTime` 字符串但不包含 date/timezone；当前路线缓存按 dayId 和坐标为主，不在 12F 改签名。相关文件：`src/lib/routeCache.ts`。

## 推荐下一步

- 当前代码还需要继续保持 plain-date 单元测试，特别是 AI import 和日期范围生成。
- Trip / Day / Item timezone 基础已经存在；后续不要新增半套字段或自动回填历史数据。
- Phase 13A 可以使用现有 selected-day / Trip timezone helper，但不要加入实时营业时间、ETA 或 provider facts，除非有 source-bearing provider flow 和确认边界。
- AI import 对 ISO datetime with timezone 的支持必须先设计显式用户确认，不得静默截断成 plain date/time。
