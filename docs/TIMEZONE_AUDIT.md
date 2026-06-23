# TripMap 时区与日期语义审计

更新时间：2026-06-23

Phase 12F / Phase 12 已完成第一轮收口。当前目标不是迁移历史数据格式，而是把日期、墙上时间、Instant 和 IANA 时区的边界固定下来，避免 UTC “今天”、设备时区、无效 timezone 和硬编码展示时区继续污染旅行语义。

## 语义定义

- `PlainDate`：`YYYY-MM-DD`，只表示旅行语境中的日期，不带时区，不等同 UTC 日期。
- `WallClockTime`：`HH:mm`，表示地点当地钟表时间，不单独代表一个绝对时刻。
- `Instant`：epoch milliseconds，用于同步、提醒、排序、版本时间和审计时间。
- `IanaTimeZone`：经过 `Intl` 校验的 IANA 时区，例如 `Asia/Tokyo`、`Europe/London`、`America/New_York`。

## 当前实现

- `src/lib/plainDate.ts` 严格校验 `YYYY-MM-DD`，拒绝溢出日期、非补零日期和完整 ISO datetime。
- `src/lib/dates.ts` 的展示和日期范围 API 使用 plain-date helper，不依赖浏览器本地 `Date` 解析旅行日期。
- `src/lib/timeSemantics.ts` 提供 `toPlainDate()`、`toWallClockTime()`、`todayInTimeZone()`、`resolveWallClockToInstant()`、`formatInstantInTimeZone()` 和 plain date 加减 / 间隔工具。
- `src/lib/timeZone.ts` 提供设备时区、Trip/Day 继承时区、Item 起止时区、坐标 timezone lookup、跨日交通起止 Instant 解析和 chronology 判断。
- `Trip.timeZone`、`Day.timeZone`、`ItineraryItem.startTimeZone`、`ItineraryItem.endDate`、`ItineraryItem.endTimeZone` 作为兼容字段存在；旧数据缺省时按 Trip/Day/设备时区继承，不做批量迁移。
- `src/hooks/useTripData.ts` 的 selected day 和 `src/lib/tripVisuals.ts` 的 Trip status 已按 Trip/Day timezone 判断，不再直接使用设备本地日期。
- AI trip-plan 导入要求日期为 `YYYY-MM-DD`，时间为 `HH:mm`，可导入并校验 Trip / Day / Item 级 IANA timezone 字段；无效 timezone 会被忽略并产生 warning。
- 同步、云端版本、历史记录和提醒比较继续使用 Instant；Cloud snapshot 版本时间展示会校验 timezone，无效 timezone fallback 到 UTC，不让同步提示崩溃。

## 字段分类

Plain travel date fields：

- `Trip.startDate`
- `Trip.endDate`
- `Day.date`
- AI import: `trip.startDate`、`trip.endDate`、`days[].date`、`tickets[].bindTo.date`

Plain local wall-clock time fields：

- `ItineraryItem.startTime`
- `ItineraryItem.endTime`
- AI import: `items[].startTime`、`items[].endTime`

IANA timezone fields：

- `Trip.timeZone`
- `Day.timeZone`
- `ItineraryItem.startTimeZone`
- `ItineraryItem.endTimeZone`
- AI import: `trip.timeZone`、`days[].timeZone`、`items[].startTimeZone`、`items[].endTimeZone`

Cross-date item fields：

- `ItineraryItem.endDate`
- AI import: `items[].endDate`

Absolute system timestamp fields：

- `Trip.createdAt`、`Trip.updatedAt`
- `ItineraryItem.createdAt`、`ItineraryItem.updatedAt`
- `TicketMeta.createdAt`、`TicketMeta.updatedAt`
- zip backup `manifest.exportedAt`
- cloud snapshot `exportedAt`
- Supabase `created_at`、`updated_at`、`exported_at`
- route cache `createdAt`、`updatedAt`、`lastUsedAt`

## DST 策略

- 不存在的墙上时间顺延到下一个有效时间。
- 重复墙上时间选择较早的 Instant。
- 导入或编辑时如果发生自动校正，表单或校验结果必须给用户可见提示。

## 编码硬规则

- 不要把 `YYYY-MM-DD` 当浏览器本地 `Date` 随意解析。
- 不要用 `toISOString().slice(0, 10)` 表示旅行日期或账本日期。
- 不要把旅行日期存成浏览器本地 ISO timestamp。
- 不要让设备当前时区改变 Trip / Day 的旅行日期。
- 不要硬编码 `Asia/Shanghai` 作为全局版本时间、今天或导出日期默认值；确需展示时必须显式传入展示时区。
- Trip / Day / ledger 日期归属使用 Trip/Day 时区。
- 旅行日期和行程时间继续以字符串表达本地墙上时间。
- 需要时区时使用 IANA timezone ID，不使用固定 UTC offset 作为长期模型。
- 同步、审计、提醒和版本比较使用 Instant。
- 用户可见同步版本时间是系统版本时间，不是旅行当地日期；无效 timezone 必须 fallback，不能让 prompt 崩溃。
- 新增 provider、地图、搜索、提醒、跨设备同步功能前，先确认字段是 PlainDate、WallClockTime、Instant 还是 IANA 时区。

## 测试覆盖

- `src/lib/plainDate.test.ts` / `src/lib/dates.test.ts`：严格日期校验、weekday、日期范围和 DST 相邻日期范围不发生时区漂移。
- `src/lib/timeSemantics.test.ts`：PlainDate、WallClockTime、纽约 DST 不存在/重复时间、`todayInTimeZone()`、Instant 格式化、plain date 加减。
- `src/lib/timeZone.test.ts`：IANA 校验、Trip/Day 时区继承、DST 边界 plain date/minute、跨日交通起止 Instant、无效 item timezone/endDate fallback。
- `src/hooks/useTripData.test.ts`：显式 day 优先，按 Trip/Day 时区选择当前 Day / 未来 Day。
- `src/lib/tripVisuals.test.ts`：Trip status 使用 Trip timezone 判断 active/planned。
- `src/lib/cloudSnapshotCheck.test.ts`：Cloud version timestamp 格式化和无效 timezone UTC fallback。
- `src/components/ItineraryItemForm.test.tsx`：DST 自动校正提示。
- `src/lib/travelReminders.test.ts`：DST 边界交通提醒转为真实 Instant。

## 仍需注意

- 旧 Trip / Day 可能没有 timezone；fallback 到设备 timezone 仍可能与目的地不一致，但自动回填会制造错误确定性。
- Trip / Day / Item timezone 字段已存在，但跨国家旅行的用户教育和高级 UI 仍不完整；用户可能不理解为何“今天”按 Day timezone 变化。
- Item 可以表达单段 arrival date/timezone，但复杂多段交通若硬塞进普通行程点仍会丢语义；多段交通和敏感订单信息优先走 Travel Document Center 的 transport booking。
- AI 或外部导入若给出完整 ISO datetime，不得静默截断；必须映射为明确 date/time/timeZone 或要求用户确认。
- Map Provider、Transit Hints、实时搜索和提醒增强都必须复用当前时间语义，不要新增平行解析逻辑。
- 未来 provider / AI 结果如果把营业时间、ETA、航班延误或实时交通当作本地 timezone 计算结果展示，会制造无来源事实。

## 推荐下一步

- 继续保持 plain-date、timezone、cloud version timestamp 和导入校验单元测试。
- Phase 13A 可以使用现有 selected-day / Trip timezone helper，但不要加入实时营业时间、ETA 或 provider facts，除非有 source-bearing provider flow 和确认边界。
- AI import 对 ISO datetime with timezone 的支持必须先设计显式用户确认，不得静默截断成 plain date/time。
- 跨国家旅行高级 UI 和多段交通解释文案应在 Item Detail / Travel Document Center 后续体验 phase 里统一设计。
