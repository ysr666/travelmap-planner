# TripMap 时区与日期语义审计

更新时间：2026-05-17

## 当前行为总结

安全的部分：

- Trip 的 `startDate` / `endDate`、Day 的 `date`、行程点的 `startTime` / `endTime` 都以字符串保存，没有存成浏览器本地 `Date` 或 ISO timestamp。
- Trip / Item 表单使用浏览器原生 `date` / `time` input，读取和写入的仍是 `YYYY-MM-DD` 与 `HH:mm` 字符串。
- AI trip-plan 导入要求日期为 `YYYY-MM-DD`，时间为 `HH:mm`，导入记录会保留这些字符串。
- zip 归档和 Supabase cloud snapshot 会序列化现有记录，不会在导出 / 恢复时转换旅行日期。
- `createdAt` / `updatedAt` 是系统时间戳；`exportedAt`、cloud metadata 和 route cache 时间是绝对系统时间，可以继续使用 epoch milliseconds 或 ISO timestamp。

已有修正：

- `src/lib/plainDate.ts` 统一处理 plain travel date：严格校验 `YYYY-MM-DD`，拒绝溢出日期、非补零日期和完整 ISO datetime。
- `src/lib/dates.ts` 保留原有导出 API，但内部改为 plain-date helper，避免 `dayjs(date)` 或本地 `new Date(...)` 解析旅行日期。
- Home、Day View、Day Selector 的旅行日期展示不再依赖浏览器当前时区或 `Intl.DateTimeFormat` 的日期解析。
- AI import 的日期校验改为 strict plain-date 校验，`startTime` / `endTime` 继续只接受 `HH:mm`。

仍有风险：

- `src/hooks/useTripData.ts` 的 `pickSelectedDay` 和 `src/lib/tripVisuals.ts` 的 `getTripStatus` 会用设备当前日期判断“今天”和“进行中”。在没有 Trip timezone 字段前，这是产品语义风险，不应在 12F 中猜测修复。
- 跨时区交通段目前只有一个 Day 和一个本地 `startTime` / `endTime`，无法表达“23:00 东京出发，07:00 伦敦抵达”这类 departure / arrival 双时区语义。
- 未来地图路线、AI 导入、Trip Home 地图概览如果开始使用营业时间、ETA、航班时间或跨日交通，需要先完成 timezone model。

未知，需要未来验证：

- 用户到达目的地后打开 PWA，Trip Home 和 Day View 的“当前日”是否应按 Trip 默认时区、Day 时区，还是用户设备时区。
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

absolute system timestamp fields：

- `Trip.createdAt`、`Trip.updatedAt`
- `ItineraryItem.createdAt`、`ItineraryItem.updatedAt`
- `TicketMeta.createdAt`、`TicketMeta.updatedAt`
- zip backup `manifest.exportedAt`
- cloud snapshot `exportedAt`
- Supabase `created_at`、`updated_at`、`exported_at`
- route cache `createdAt`、`updatedAt`、`lastUsedAt`

future timezone fields：

- Trip default timezone: optional IANA timezone，例如 `Asia/Tokyo`、`Europe/London`
- Day timezone: 默认继承 Trip timezone，未来可选覆盖
- Item timezone: 默认继承 Day timezone，未来可选覆盖
- Cross-timezone transport: 未来需要 departure timezone / arrival timezone，不能只靠一个 `startTime` / `endTime`

## 推荐模型

- Travel date: `YYYY-MM-DD` plain date，只表示旅行上下文中的日期，不表示 UTC 日期，也不表示设备本地日期。
- Itinerary time: `HH:mm` local wall-clock time，只表示目的地 / 当日上下文中的墙上时间。
- Trip default timezone: 未来可选 IANA timezone。没有字段前，不能自动推断，也不能迁移现有数据。
- Day timezone: 默认继承 Trip timezone；跨国家旅行时未来允许按 Day 覆盖。
- Item timezone: 默认继承 Day timezone；一般景点和餐厅不需要单独设置。
- Cross-timezone transport: 未来用 departure / arrival 两组日期、时间、timezone 表达，不要把航班或夜车硬塞进单个本地时间。
- `updatedAt` / `exportedAt`: 继续使用绝对系统时间，用于排序、冲突检查、同步版本判断。

本阶段暂缓添加 timezone 字段，原因：

- 没有批准 IndexedDB schema migration，也没有 Supabase schema 变更。
- 现有历史数据只记录 plain date/time，不包含用户当时的目的地时区意图，自动补 timezone 会制造错误确定性。
- 跨时区交通需要 departure / arrival 模型、AI schema、表单 copy、导入降级策略一起设计，单加 Trip timezone 不能解决核心问题。
- 12F 的目标是先保证当前 plain-date 不被设备时区静默改变，为后续设计留出干净边界。

## 未来编码硬规则

- 不要把 `YYYY-MM-DD` 当浏览器本地 `Date` 随便解析。
- 不要把旅行日期存成浏览器本地 ISO timestamp。
- 不要让设备当前时区改变 Trip / Day 的旅行日期。
- 旅行日期和行程时间继续以字符串表达本地墙上时间。
- 需要时区时使用 IANA timezone ID，不使用固定 UTC offset 作为长期模型。
- 绝对系统时间和旅行本地日期必须分开命名、分开处理。

## 分阶段建议

- Phase 12F-1: 已完成 plain-date tests and helper hardening。
- Phase 12F-2: 设计 optional Trip timezone 字段，先写 schema / migration / copy / import 策略。
- Phase 12F-3: 设计 Day / Item timezone inheritance，明确 UI 只在跨时区旅行时出现。
- Phase 12F-4: 设计 AI import timezone support，对完整 ISO datetime 给出用户确认或显式映射。
- Phase 12F-5: 设计 cross-timezone transport segment，支持出发和到达各自的 date/time/timezone。
- Phase 12F-6: 如确有必要，再加入 Trip timezone UI copy / setting。

## 风险列表

High：

- 未来 AI import 或 route generation 如果静默把完整 ISO datetime 截断为 `YYYY-MM-DD` / `HH:mm`，会改变跨时区航班和夜车语义。相关文件：`src/lib/tripPlanImport.ts`、未来 AI schema 文档。
- Phase 13A Trip Home 地图概览如果按设备时区推断“今天”或自动聚合跨国日程，可能错选旅行日。相关文件：`src/hooks/useTripData.ts`、未来 Trip Home map overview。

Medium：

- `pickSelectedDay` 目前用设备本地 today 选择当前 Day。用户在美国规划东京旅行时，边界时刻可能和东京日期不同。相关文件：`src/hooks/useTripData.ts`。
- `getTripStatus` 目前用设备本地 today 判断计划中 / 进行中 / 已结束。相关文件：`src/lib/tripVisuals.ts`。
- 跨时区交通无法完整表达 departure / arrival 两端日期时间。相关字段：`ItineraryItem.startTime`、`ItineraryItem.endTime`。

Low：

- `buildTripBackupFileName` 和导入副本标题后缀使用设备本地时间生成文件名 / 标题。这是系统操作时间，不是旅行日期，当前可接受。相关文件：`src/lib/backup.ts`。
- Cloud snapshot prompt 时间使用固定 `Asia/Shanghai` 展示版本时间。这是系统版本提示，不影响旅行日期。相关文件：`src/lib/cloudSnapshotCheck.ts`。
- route cache signature 包含 `startTime` 字符串但不包含 date/timezone；当前路线缓存按 dayId 和坐标为主，不在 12F 改签名。相关文件：`src/lib/routeCache.ts`。

## 推荐下一步

- 当前代码还需要继续保持 plain-date 单元测试，特别是 AI import 和日期范围生成。
- Trip timezone 不建议现在加入；应推迟到有 schema migration、导入策略、UI copy 和跨时区交通模型后再做。
- Phase 13A 在 timezone model 完成前，应避免实现依赖“当前旅行日自动判断”的地图概览逻辑；如果必须展示，只按已有 Day 顺序和 plain date 字符串展示。
