# AI Agent Foundation

本阶段只建立本地、只读的行程上下文和规则检查层，不调用外部 AI API，也不自动写入 IndexedDB、Supabase 或备份文件。

## Travel Profile

Travel Profile 是用户在本机配置的旅行偏好，用于后续 AI 简报、建议和生成能力理解用户节奏。当前字段包括：

- 旅行节奏：轻松 / 适中 / 紧凑。
- 交通偏好：公共交通优先 / 步行为主 / 可接受打车 / 综合。
- 是否保护饭点。
- 希望几点后开始、希望几点前结束。
- 提醒强度：轻提醒 / 标准 / 详细。

本阶段只允许旅行节奏影响保守的本地规则阈值，例如“当天安排偏密”的行程点数量。不得基于这些偏好新增路线、用餐、营业时间、实时交通或天气推断。

Travel Profile 只保存在当前浏览器 `localStorage` 的 `tripmap:travel-profile`。它不进入 IndexedDB、zip 备份、Supabase 云端保存或云端同步。

## AI 隐私与数据范围

AI 隐私设置用于控制未来 AI 功能可读取的数据范围。当前本地检查不受这些开关限制：它仍只在设备内使用已存在的安全结构化上下文，不上传数据，也不调用外部 AI。

数据范围设置只保存在当前浏览器 `localStorage` 的 `tripmap:ai-privacy`。它不进入 IndexedDB、zip 备份、Supabase 云端保存或云端同步。

默认策略保持保守：未来 AI 可读取的数据范围默认全部关闭，尤其是以下字段必须默认关闭：

- 票据文件名 / 标题。
- 完整备注内容。
- 票据图片/PDF 内容。
- 云端保存/同步状态。

票据图片、PDF、Blob 或文件正文在本阶段不可开启，也不得被读取、解析、上传或发送。

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
- 每次外部 AI 调用前都必须经过当前数据范围设置过滤。
- 输出 schema 校验，所有建议都必须结构化、可解释、可追踪 evidence。
- 写入前必须由用户确认；AI 不直接修改数据库。
- 对敏感字段继续默认排除，尤其是票据/护照/签证内容、证件材料、完整备注、完整坐标、URL、本机路径和密钥。

未来可以复用 `future_ai` 作为结果 source 类型，但当前版本不得实际发出 `future_ai` finding。

## 结果来源区别

- `local_rule`：当前已实现，只在本机运行，只读，不调用外部服务。
- `future_ai`：未来可用于标记 AI 生成的建议；必须先经过数据范围过滤、schema 校验和用户确认流程。
- 外部 AI API 调用：当前未实现。未来如接入，必须有显式用户许可，不得后台自动上传，不得自动修改数据库。

## UI 文案

在没有外部 AI 接入前，用户可见入口使用”行程体检””本地检查””今日简报”等中性文案，不写”AI 已读取文件”或类似表达。

## AI 草稿管道

AI 草稿管道允许用户在本地预览和导入 AI 生成的行程草稿，无需外部 AI 调用。

### 当前阶段

当前阶段支持两种方式生成草稿：

1. **请求表单 + 本地 mock 生成**：用户填写目的地、日期、旅行偏好和补充要求，系统在本地生成示例草稿。不会调用外部 AI，不会上传数据。
2. **粘贴 JSON 草稿**：用户手动粘贴 JSON 或加载示例草稿。

所有解析和验证都在本地完成，不调用外部 AI 服务。

### AI Draft Request Builder

请求表单允许用户在本地构建 AI 草稿请求，当前阶段使用本地 mock 生成器返回示例草稿。

**请求字段：**

- `destination`（必填）：目的地，最长 200 字符。
- `startDate`（必填）：开始日期，严格 YYYY-MM-DD 格式。
- `endDate`（必填）：结束日期，严格 YYYY-MM-DD 格式，不能早于开始日期，最长 120 天。
- `pace`（可选）：旅行节奏，读取 Travel Profile 默认值。
- `preferTransport`（可选）：交通偏好，读取 Travel Profile 默认值。
- `mealTimeProtection`（可选）：是否保护饭点。
- `mustVisitText`（可选）：想去的地方，最长 2000 字符。
- `avoidText`（可选）：不想要的安排，最长 2000 字符。
- `freeTextRequirement`（可选）：补充要求，最长 2000 字符。

**当前阶段：**

- 请求表单 + 本地 mock 生成器。
- mock 生成器完全本地运行，确定性输出，不调用外部服务。
- 生成的草稿必须通过 `validateAiTripDraft` schema 校验。
- 用户必须在导入前确认。

**未来阶段：**

- 真实 AI 生成必须通过 Provider Proxy 调用。
- 请求必须遵守 AI Privacy / Travel Profile 设置。
- AI 返回的草稿必须通过 `aiTripDraft` schema 校验。
- 用户确认前不得写入本地旅行。
- 不读取票据图片 / PDF / OCR。
- 不自动生成路线或优化顺序。

1. 用户粘贴 JSON 草稿或加载示例。
2. 本地验证草稿结构和字段。
3. 验证通过后显示摘要和预览。
4. 用户确认后才写入 IndexedDB。
5. 导入后导航到新旅行工作台。

### 验证规则

- 旅行标题不能为空。
- 日期必须是严格的 YYYY-MM-DD 格式。
- 日期必须是有效日期（如 2025-02-30 无效）。
- 结束日期不能早于开始日期。
- 时间必须是 HH:mm 格式。
- 交通方式必须在允许范围内。
- 坐标必须在有效范围内。
- 天数不能超过 120 天。
- 每天行程点不能超过 50 个。
- 总行程点不能超过 1000 个。

### 写入边界

在用户点击”确认导入”之前：

- 不创建旅行、天或行程点记录。
- 不写入 IndexedDB。
- 不触发路线生成。
- 不触发云端上传。
- 不创建票据。

### 未来 AI 接入

未来外部 AI 生成的行程必须：

- 通过 Provider Proxy 调用。
- JSON 草稿必须通过本地验证。
- 用户必须在导入前确认。
- 不得自动读取票据图片/PDF/OCR。
- 不得自动生成路线或优化顺序。

### 通过 Provider Proxy 生成草稿

当前阶段已建立 `ai_trip_draft` proxy operation 基础：

- 前端可通过 `fetchProviderProxyAiTripDraft` 向 proxy 发送草稿生成请求。
- 当前 proxy 仅返回本地 mock 草稿（`TRIPMAP_PROVIDER_PROXY_MOCK=1`），不调用真实 AI。
- 未配置 proxy 时，按钮显示为禁用状态。
- 请求前需用户确认，确认文案说明可能消耗额度、不会自动创建旅行等。
- proxy 返回的草稿必须通过 `validateAiTripDraft` schema 校验。
- 用户仍需 preview 和 ConfirmDialog 确认后才写入 IndexedDB。
- AI 草稿请求有独立的 quota 限制（10次/60秒），与路线 preview quota 隔离。

隐私边界：

- 请求仅包含目的地、日期、旅行偏好和补充文本。
- 不包含票据内容、云端 token、API key。
- 不读取票据图片/PDF/OCR。
- 不包含完整旅行数据库。
- AI provider key 仅存在于 server proxy 环境变量中，前端不可见。

未来真实 AI 接入时：

- `TRIPMAP_AI_PROVIDER_KEY` 仅在 server proxy 中使用。
- 响应 `source` 字段从 `"mock"` 变为 `"future_ai"`。
- 草稿仍需通过 `validateAiTripDraft` 校验。
- 用户确认前不得写入本地旅行。

### Real Provider Preparation

当前阶段已完成服务端基础设施，为未来真实 AI provider 接入做好准备。当前不调用真实外部 AI。

已完成：

- Prompt builder（`aiDraftPrompt.ts`）：纯函数，从已验证请求构建 prompt。用户 free text 限制 500 字符。Prompt 要求只输出 JSON，符合 AiTripDraft schema。
- Provider adapter（`aiDraftProvider.ts`）：provider-agnostic 接口。当前实现：mock（确定性草稿）、unavailable（无 key）、disabled（有 key 但无真实 provider）。不实现厂商专属 adapter。
- Response extraction（`aiDraftResponse.ts`）：从 raw AI 输出提取 JSON（纯 JSON 或 fenced block），通过 `validateAiTripDraft` 校验。失败返回 `invalid_response`，不透传 raw output。
- Limits（`aiDraftLimits.ts`）：per-request 资源限制（prompt 长度、output tokens、free text embed 长度）。
- 新增 `invalid_response` 错误码。

Prompt 边界：

- 不包含：票据图片/PDF/OCR、cloud token、provider key、完整数据库、route cache、精确坐标。
- 明确要求：日期 YYYY-MM-DD、时间 HH:mm、不生成票据/路线/cloud 字段/provider metadata/公交线路号/路线重排。

响应边界：

- Model output 必须经过 JSON extraction + `validateAiTripDraft`。
- 无效输出返回 `invalid_response`，不透传 raw model text。
- 错误消息通用，不包含 raw output 或用户输入。

生产部署前：

- 需要 durable quota（KV / Supabase / Redis）替代内存 Map。
- 需要 origin allowlist 和 account/session/IP 控制。
- 需要计费和滥用防护。
