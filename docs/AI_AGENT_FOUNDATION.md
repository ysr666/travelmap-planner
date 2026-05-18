# AI Agent Foundation

本阶段只建立本地、只读的行程上下文和规则检查层，不调用外部 AI API，也不自动写入 IndexedDB、Supabase 或备份文件。

## Trip Context 边界

`buildTripContext` 的目标是把 TripMap 现有数据整理成稳定、可解释、可测试的结构化上下文。它面向未来 AI Agent，但当前只给本地规则使用。

当前允许进入上下文的内容：

- 旅行标题、目的地、日期范围。
- Day 的日期、标题、排序和行程点数量。
- 行程点的时间、标题、地点名、地址。
- 坐标状态：`missing` / `present` / `invalid`，不包含完整经纬度。
- 上一段交通的方式、耗时是否存在、备注是否存在。
- 备注是否存在或粗略长度，不包含完整备注文本。
- 票据数量、绑定状态、scope / storage / fileType 统计。

当前禁止进入上下文的内容：

- 票据图片、PDF、Blob 或文件正文。
- 票据文件名、外部 URL、reference 本地路径。
- 护照、签证、银行卡等文件内容。
- Supabase session、API key、云端 token 或本机密钥。
- 完整经纬度和完整备注文本。

## 本地检查优先

`analyzeTripContext` 只使用本地结构化数据，输出 `summary`、`warnings`、`suggestions` 和 `evidence`。所有当前 finding 的 `source` 都必须是 `local_rule`。

规则保持保守：

- 缺少或异常坐标。
- 相邻行程点缺少交通耗时。
- 空白日、当天安排过密、当天首尾跨度过长。
- 相邻 timed item 间隔过短或时间重叠。
- 只对明显关键词提示可能缺少票据：门票、预约、ticket、reservation、booking、入场、凭证。

本地检查不估算真实路线，不调用地图或路线服务，不推断营业时间、天气、实时交通或票价。

## 未来 AI 接入条件

外部 AI 是后续阶段，接入前必须先完成：

- 明确的数据范围开关，让用户知道哪些结构化字段会被发送。
- 明确的用户授权，不做后台自动上传。
- 输出 schema 校验，所有建议都必须结构化、可解释、可追踪 evidence。
- 写入前必须由用户确认；AI 不直接修改数据库。
- 对敏感字段继续默认排除，尤其是票据文件内容、证件材料、完整备注和密钥。

未来可以复用 `future_ai` 作为结果 source 类型，但当前版本不得实际发出 `future_ai` finding。

## UI 文案

在没有外部 AI 接入前，用户可见入口使用“行程体检”“本地检查”“今日简报”等中性文案，不写“AI 已读取文件”或类似表达。
