# TripMap 时区与日期语义审计

更新时间：2026-06-22

Phase 12F 已完成第一轮收口。当前目标不是迁移历史数据格式，而是把日期、墙上时间、Instant 和 IANA 时区的边界固定下来，避免 UTC “今天”、设备时区和硬编码时区继续污染旅行语义。

## 语义定义

- `PlainDate`：`YYYY-MM-DD`，只表示旅行语境中的日期，不带时区，不等同 UTC 日期。
- `WallClockTime`：`HH:mm`，表示地点当地钟表时间，不单独代表一个绝对时刻。
- `Instant`：epoch milliseconds，用于同步、提醒、排序、版本时间和审计时间。
- `IanaTimeZone`：经过 `Intl` 校验的 IANA 时区，例如 `Asia/Tokyo`、`Europe/London`、`America/New_York`。

## 当前实现

- `src/lib/timeSemantics.ts` 提供 `toPlainDate()`、`toWallClockTime()`、`todayInTimeZone()`、`resolveWallClockToInstant()`、`formatInstantInTimeZone()` 和 plain date 加减/间隔工具。
- `src/lib/timeZone.ts` 提供设备时区、Trip/Day 继承时区、Item 起止时区、跨日交通起止 Instant 解析。
- `Trip.timeZone`、`Day.timeZone`、`ItineraryItem.startTimeZone`、`ItineraryItem.endDate`、`ItineraryItem.endTimeZone` 作为兼容字段存在；旧数据缺省时按 Trip/Day/设备时区继承，不做批量迁移。
- Ledger “今天”、Document 导出日期、Trip Home / Day / Live / Operations 的今天判断已使用 Trip/Day 时区工具，不再依赖 UTC `toISOString().slice(0, 10)`。
- 同步、云端版本、历史记录和提醒比较继续使用 Instant；显示时按当前设备或指定展示时区格式化。
- 跨日交通按出发日期/时间/时区与到达日期/时间/时区分别解析，校验到达 Instant 不早于出发 Instant。

## DST 策略

- 不存在的墙上时间顺延到下一个有效时间。
- 重复墙上时间选择较早的 Instant。
- 导入或编辑时如果发生自动校正，表单或校验结果必须给用户可见提示。

## 编码硬规则

- 不要把 `YYYY-MM-DD` 当浏览器本地 `Date` 随意解析。
- 不要用 `toISOString().slice(0, 10)` 表示旅行日期或账本日期。
- 不要硬编码 `Asia/Shanghai` 作为全局版本时间、今天或导出日期默认值；确需展示时必须显式传入展示时区。
- Trip/Day/ledger 日期归属使用 Trip/Day 时区。
- 同步、审计、提醒和版本比较使用 Instant。
- 新增 provider、地图、搜索、提醒、跨设备同步功能前，先确认字段是 PlainDate、WallClockTime、Instant 还是 IANA 时区。

## 测试覆盖

- `src/lib/timeSemantics.test.ts`：PlainDate、WallClockTime、纽约 DST 不存在/重复时间、`todayInTimeZone()`、Instant 格式化、plain date 加减。
- `src/lib/timeZone.test.ts`：IANA 校验、Trip/Day 时区继承、DST 边界 plain date/minute、跨日交通起止 Instant。
- `src/hooks/useTripData.test.ts`：按 Trip/Day 时区选择当前 Day。
- `src/components/ItineraryItemForm.test.tsx`：DST 自动校正提示。
- `src/lib/travelReminders.test.ts`：DST 边界交通提醒转为真实 Instant。
- `src/lib/plainDate.test.ts` / `src/lib/dates.test.ts`：DST 相邻日期范围不发生时区漂移。

## 仍需注意

- 现有字段兼容旧数据，不代表所有历史旅行都有准确目的地时区；缺省时区仍可能来自设备时区。
- AI 或外部导入若给出完整 ISO datetime，不得静默截断；必须映射为明确 date/time/timeZone 或要求用户确认。
- Map Provider、Transit Hints、实时搜索和提醒增强都必须复用当前时间语义，不要新增平行解析逻辑。
- UI 还可以继续改善跨时区交通的解释文案，让用户清楚看到出发地和到达地各自日期时间。
