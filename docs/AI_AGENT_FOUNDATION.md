# AI Agent Foundation

当前 AI 基础能力分为两层：

- 本地、只读的旅行上下文和质量检查层：不调用外部 AI，不写入 IndexedDB、Supabase 或备份文件。
- AI 草稿生成 / 修复层：可选通过 TripMap provider proxy 调用真实 AI provider；请求前必须用户确认，返回结果必须经过 JSON extraction 和 `validateAiTripDraft`，最终写入仍需要用户再次确认导入。

外部 AI 只用于生成或修复草稿 preview，不直接修改已保存旅行。

## Current AI Draft Capability Status

当前可用能力：

- Local request builder：用户填写目的地、日期、节奏、交通偏好和补充要求，可生成本地 mock 草稿。
- Real provider generation：配置 server-side AI env 后，可通过 `/api/provider-proxy` 使用 OpenAI-compatible provider 生成草稿；DeepSeek `deepseek-v4-flash` 已完成真实 smoke。
- Quality checker：草稿 preview 后运行本地质量检查，提示过密、泛化标题、缺少饭点、时间冲突、短间隔等问题。
- AI repair：质量检查出现 warnings / criticals 时，用户确认后可通过 provider proxy 请求 AI 修复当前草稿。DeepSeek `deepseek-v4-flash` repair smoke 已验证成功。
- Privacy Guard：repair 请求发送前会按 AI 隐私设置移除或截断 item notes；默认关闭时备注不会发送。
- ConfirmDialog write boundary：AI 生成和修复只更新草稿 preview 和 JSON textarea；只有用户点击最终“确认导入”后才写入 IndexedDB。

当前明确限制：

- 不接入真实 web search，不查询实时营业时间、票价、交通、天气或网页来源，也不会声称已查询实时来源。`travel_search` 当前只是 provider proxy foundation：mock/disabled only，没有真实 provider、没有 UI、没有 AI 自动调用。
- 不提供 thinking / reasoning mode UI。推理模式由后端策略管理；默认保持 stable JSON mode，复杂任务才可由后端自动选择更高推理强度。
- 不直接编辑已保存旅行，不输出自动写库 patch。
- 不读取票据图片、PDF、OCR、Blob、完整本地数据库、云端 token、route cache 或 provider key。
- 不自动生成路线、不优化行程顺序、不创建票据、不上传云端。

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

AI 隐私设置控制 AI 草稿生成和修复时通过旅图服务发送的数据范围。当前本地检查不受这些开关限制：它仍只在设备内使用已存在的安全结构化上下文，不上传数据，也不调用外部 AI。

数据范围设置只保存在当前浏览器 `localStorage` 的 `tripmap:ai-privacy`。它不进入 IndexedDB、zip 备份、Supabase 云端保存或云端同步。

默认策略保持保守：AI 可读取的数据范围默认全部关闭，尤其是以下字段必须默认关闭：

- 票据文件名 / 标题。
- 完整备注内容。
- 票据图片/PDF 内容。
- 云端保存/同步状态。

### AI Privacy Guard

`src/lib/aiPrivacyGuard.ts` 中的纯函数在 AI 请求发送给 provider proxy 前进行数据过滤：

- `sanitizeAiDraftRepairDraftForProxy` — 根据隐私设置处理 draft 中 item 的备注字段。allowFullNotes 开启时保留完整备注，allowNotesSummary 开启时截取前 80 字符，都关闭时移除备注。
- `sanitizeAiDraftRepairFindingsForProxy` — 过滤 quality findings（当前为 pass-through）。
- `summarizeAiPrivacyForAiRequest` — 生成简短中文说明，在确认对话框向用户展示已限制哪些数据类型。

这些函数不读 localStorage、不读写 IndexedDB、不调用网络、不修改输入对象。

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

## 外部 AI 调用条件

任何外部 AI 调用都必须满足：

- 明确的数据范围开关，让用户知道哪些结构化字段会被发送。
- 明确的用户授权，不做后台自动上传。
- 每次外部 AI 调用前都必须经过当前数据范围设置过滤。
- 输出 schema 校验，所有建议都必须结构化、可解释、可追踪 evidence。
- 写入前必须由用户确认；AI 不直接修改数据库。
- 对敏感字段继续默认排除，尤其是票据/护照/签证内容、证件材料、完整备注、完整坐标、URL、本机路径和密钥。

AI provider 成功返回的草稿 source 可为 `future_ai`。本地质量检查 finding 仍保持 `local_rule`，不得把本地规则伪装成 AI finding。

## 结果来源区别

- `local_rule`：当前已实现，只在本机运行，只读，不调用外部服务。
- `future_ai`：用于标记真实 provider 生成或修复出的草稿；必须先经过数据范围过滤、schema 校验和用户确认流程。
- 外部 AI API 调用：只允许通过 provider proxy，必须有显式用户许可，不得后台自动上传，不得自动修改数据库。

## UI 文案

本地规则入口使用“草稿检查”“本地检查”等中性文案，不写“AI 已读取文件”或类似表达。AI 生成 / 修复入口必须说明会通过旅图服务、可能消耗额度、不会自动创建或修改旅行。

## AI 草稿管道

AI 草稿管道允许用户预览和导入 AI 行程草稿。草稿可以来自本地 mock、手动粘贴 JSON，或可选真实 provider。

### 当前阶段

当前阶段支持三种方式生成草稿或修复草稿：

1. **请求表单 + 本地 mock 生成**：用户填写目的地、日期、旅行偏好和补充要求，系统在本地生成示例草稿。不会调用外部 AI，不会上传数据。
2. **粘贴 JSON 草稿**：用户手动粘贴 JSON 或加载示例草稿。
3. **Provider proxy 真实 AI 生成 / 修复**：配置 server-side AI env 后，用户确认才通过 `/api/provider-proxy` 请求真实 provider。返回草稿只更新 preview，导入前不写本地旅行。

所有返回草稿都必须在本地完成 JSON extraction 和 schema validation。

### AI Draft Request Builder

请求表单允许用户在本地构建 AI 草稿请求。默认本地 mock 生成器可用；配置 provider proxy 后，也可以通过真实 AI provider 生成草稿。

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
- 配置 `TRIPMAP_AI_PROVIDER=openai_compatible`、server-side key、base URL 和 model 后，可通过 provider proxy 请求真实 AI。
- 生成的草稿必须通过 `validateAiTripDraft` schema 校验。
- 用户必须在导入前确认。

**Provider 边界：**

- 请求必须遵守 AI Privacy / Travel Profile 设置。
- AI 返回的草稿必须通过 `aiTripDraft` schema 校验。
- 用户确认前不得写入本地旅行。
- 不读取票据图片 / PDF / OCR。
- 不自动生成路线或优化顺序。
- 不搜索网页。

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

### Provider Proxy AI 边界

外部 AI 生成或修复的行程必须：

- 通过 Provider Proxy 调用。
- JSON 草稿必须通过本地验证。
- 用户必须在导入前确认。
- 不得自动读取票据图片/PDF/OCR。
- 不得自动生成路线或优化顺序。

### 通过 Provider Proxy 生成草稿

当前阶段已建立 `ai_trip_draft` proxy operation：

- 前端可通过 `fetchProviderProxyAiTripDraft` 向 proxy 发送草稿生成请求。
- `TRIPMAP_PROVIDER_PROXY_MOCK=1` 时返回本地 mock 草稿。
- `TRIPMAP_AI_PROVIDER=openai_compatible` 且 env 完整时调用真实 AI provider。
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

真实 AI 返回时：

- `TRIPMAP_AI_API_KEY` 仅在 server proxy 中使用。
- 响应 `source` 字段为 `"future_ai"`。
- 草稿仍需通过 `validateAiTripDraft` 校验。
- 用户确认前不得写入本地旅行。

### Real Provider Infrastructure

当前阶段已完成服务端基础设施，并已接入 OpenAI-compatible real provider。默认仍关闭，只有配置 server-side env 后才会调用真实外部 AI。

已完成：

- Prompt builder（`aiDraftPrompt.ts`）：纯函数，从已验证请求构建 prompt。用户 free text 限制 500 字符。Prompt 要求只输出 JSON，符合 AiTripDraft schema。
- Provider adapter（`aiDraftProvider.ts` / `aiDraftRealProvider.ts`）：provider-agnostic 接口。当前实现：mock、unavailable、disabled、OpenAI-compatible real provider。
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

### Real AI Provider Adapter

真实 AI provider adapter 已实现，但默认关闭。

配置方式（server-side env only）：

- `TRIPMAP_AI_PROVIDER=openai_compatible` 启用真实 AI。
- `TRIPMAP_AI_API_KEY` — server-only 密钥，前端不可见。
- `TRIPMAP_AI_BASE_URL` — OpenAI-compatible endpoint，推荐 `https://.../v1`。
- `TRIPMAP_AI_MODEL` — 模型标识。

默认行为：

- `TRIPMAP_AI_PROVIDER` 未设置或为 `disabled` → 不调用真实 AI。
- `TRIPMAP_PROVIDER_PROXY_MOCK=1` → 优先走 mock，忽略真实 provider。
- env 不完整（缺 key/baseURL/model）→ 返回 `provider_unavailable`。

请求边界：

- 请求体只包含 model、messages、max_tokens、`response_format: { type: "json_object" }` 和后端策略选择的 reasoning 参数。默认 / simple / auto 路径使用 `temperature: 0.2` 与 `thinking: { type: "disabled" }`；high 路径由后端策略触发，使用 `thinking: { type: "enabled" }` 与 `reasoning_effort: "high"`，不发送 temperature。
- 不包含票据、blob、cloud token、provider key、route cache。
- Authorization header 使用 server env API key。

响应边界：

- Provider 返回 raw text → handler 调用 `normalizeAiDraftProviderOutput`。
- JSON extraction → `validateAiTripDraft` 校验。
- 校验失败返回 `invalid_response`，不透传 raw model text。
- 错误不包含 API key、raw body、stack trace。

前端不变：

- 按钮、流程、ConfirmDialog、preview、import 全部不变。
- 真实 AI 只在 server proxy 内调用。
- 用户仍必须确认后才写入 IndexedDB。
- 本地 mock 仍可用作 demo/fallback。

### Real Provider Smoke Boundary

Real AI draft provider 已完成最小真实链路验证（DeepSeek `deepseek-v4-flash`，1-request smoke）。

验证确认的边界：

- Real AI 请求只在用户点击"确认生成"之后发生。
- 确认前零 provider 请求。
- 返回内容经过 JSON extraction 和 `validateAiTripDraft`。
- 成功进入 preview。
- 确认导入前没有写 IndexedDB（无 trip、route、ticket 创建）。
- 不自动生成路线。
- 不创建票据。
- 不上传云端。
- 不读取票据图片/PDF/OCR。

Real AI draft repair provider 也已完成真实链路验证（DeepSeek `deepseek-v4-flash`，successful smoke）：

- Repair 请求只在用户点击“确认修复”之后发生。
- 成功 smoke 中前端到 `/api/provider-proxy` 的 `ai_trip_draft_repair` 请求数为 1。
- Handler 没有 retry path；server 到 DeepSeek `/chat/completions` 的上游请求按一次推断。
- 修复草稿返回后经过 JSON extraction 和 `validateAiTripDraft`。
- Preview 和 JSON textarea 更新为修复版草稿。
- 最终“确认导入”前没有 IndexedDB 写入。
- 没有 route generation/cache、ticket creation、cloud upload/delete 或 sortOrder optimization。
- 页面和构建产物检查未发现 API key、Bearer header、raw provider body 或 stack trace 泄漏。

仍必须保留的流程：

- Preview 展示。
- Schema validation。
- ConfirmDialog 确认。
- 用户确认后才写入本地旅行。

### AI Draft Quality Guardrails

本地质量检查在 preview 阶段运行，纯函数，不调用网络。

检查规则：

- 单日行程点过多（根据 Travel Profile 节奏阈值）。
- 时间间隔过短（相邻 timed items 间隔 < 30 分钟）。
- 时间重叠。
- 单日跨度过长（> 12 小时）。
- 缺少地点信息。
- 标题过于笼统（同一天多个泛化标题）。
- 缺少用餐安排（保护饭点模式下）。
- 缺少交通信息（info 级别）。

Findings 是非阻塞提醒，不阻止导入。用户仍可选择直接导入。

AI 修复（`ai_trip_draft_repair`）通过 provider proxy 调用，修复后的 draft 替换当前 preview，必须重新经过 schema validation 和 ConfirmDialog 才能导入。

修复流程不：

- 自动写入本地旅行。
- 自动生成路线。
- 创建票据。
- 读取票据图片/PDF/OCR。
- 上传云端。
