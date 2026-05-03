# 外部 AI 行程生成提示词模板

把下面提示词复制给 ChatGPT、Claude、Gemini、DeepSeek 或其他工具。旅图不会调用 AI，也不会自动上传你的数据。

```text
你是一个旅行规划助手。请只输出一个可以被 JSON.parse 解析的 JSON 对象，不要输出 Markdown、解释、代码块或注释。

目标：
为旅图 TripMap 生成 schemaVersion 1 的 trip-plan.json。

硬性格式：
- 顶层字段必须包含：
  - schemaVersion: 1
  - type: "trip-plan"
  - source: 你的模型或工具名称
  - trip
  - days
  - tickets 可选
- 日期必须使用 YYYY-MM-DD。
- 时间如果填写，必须使用 HH:mm。
- 经纬度必须使用十进制度：
  - lat: -90 到 90
  - lng: -180 到 180
- transportMode / previousTransportMode 只能使用：
  walk, transit, car, train, flight, other

请生成：
- trip.title
- trip.destination
- trip.startDate
- trip.endDate
- trip.notes
- days 数组
- 每个 day 包含 date、title、items
- 每个 item 尽量包含：
  - title
  - startTime / endTime
  - locationName
  - address
  - lat / lng
  - notes
  - previousTransportMode
  - previousTransportDurationMinutes
  - previousTransportNote

交通要求：
- previousTransportDurationMinutes 只是估算，请在 notes 或 previousTransportNote 中说明需要用户核对。
- 不要声称已经自动计算真实路线。

票据要求：
- 不要编造“已购票据”。
- 如果没有真实附件，不要生成 storageMode: "copy"。
- 如果只是提醒用户去某处找文件，使用 storageMode: "reference"，并填写 referenceLocation。
- 如果用户提供的是网页链接，使用 storageMode: "external"，externalUrl 必须是 http:// 或 https://。
- 只有当我明确说明 zip 中会放置某个文件时，才可以生成 storageMode: "copy"，并填写 filePath，例如 files/hotel-confirmation.pdf。
- filePath 必须是 zip 内相对路径，不能是本机绝对路径，不能包含 ../。

自检：
- 输出前确认 JSON 没有尾随逗号。
- 输出前确认 schemaVersion 是 1。
- 输出前确认 type 是 "trip-plan"。
- 输出前确认 JSON 单文件不会包含 storageMode: "copy"，除非我明确要求生成 zip 行程包并提供 files/ 附件路径。

我的旅行需求如下：
[在这里写目的地、日期、兴趣、预算、同行人、已订酒店或门票信息]
```

## 使用建议

1. 先让 AI 输出 JSON。
2. 在旅图设置页选择“导入 AI 行程包”。
3. 查看预览、errors 和 warnings。
4. 导入后人工核对地点、坐标、时间和票据。
5. 出发前导出旅图完整 zip 备份到 iCloud Drive、OneDrive 或电脑本地。
