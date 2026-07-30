# 实时路线与出行事实

路线是旅图在线旅行运行时的一部分。目标体验会根据当前行程、出发时间和实时 Provider facts 提供可执行路线、交通状态与 ETA；地图 polyline 只是这一能力的可视化结果。

## 产品目标与当前能力

**目标：** 在 AI Action Gateway 与日程上下文中统一提供地点解析、交通方式、出发时刻、实时交通或班次、预计到达时间、服务异常和可重试路线计划。每项动态事实都必须带来源、观测时间、适用时区和过期时间。

**当前：** 配置路线服务后，用户可手动生成道路路线 polyline 和顺序建议；不提供语音导航、turn-by-turn、实时交通、实时公交班次或离线路线。地点搜索与补坐标由独立 Place 操作处理。路线请求失败时回退到已缓存路线或直线连接。

## Provider Proxy

生产路线服务应通过 TripMap provider proxy 调用后端 provider。前端只知道 proxy URL 和用于 route cache identity 的具体 provider，不保存也不展示 provider secrets。

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

Cloudflare Pages Function 入口为 `functions/api/provider-proxy.ts`。OpenRouteService、Google Routes 和 AI provider secrets 只应来自后端运行时 env binding，例如 `OPENROUTESERVICE_API_KEY`、`GOOGLE_ROUTES_API_KEY`、`GOOGLE_MAPS_PLATFORM_API_KEY` 和 `TRIPMAP_AI_API_KEY`。

浏览器可见的 Google Maps JavaScript 渲染 key 是另一类公开受限 key，应在 Google Cloud Console 通过 referrer 限制。若 Maps JS、Google Routes 和 Google Places 使用同一个实际 Google Maps Platform key 值，后端仍应通过 `GOOGLE_MAPS_PLATFORM_API_KEY` 读取同一个值，而不是读取 `VITE_GOOGLE_MAPS_API_KEY`。

## 前端 Key 风险

不要把 `OPENROUTESERVICE_API_KEY`、`GOOGLE_ROUTES_API_KEY`、`GOOGLE_MAPS_PLATFORM_API_KEY` 或 AI provider secrets 放进任何 `VITE_*` 变量。`VITE_*` 会进入前端 bundle。Settings 不提供 Google/ORS/AI key 输入、保存、清除或展示控件。

前端不再使用 `VITE_OPENROUTESERVICE_API_KEY`、旧 ORS localStorage key，或 Google Maps JS key 直接调用 OpenRouteService / Google Routes。公开部署和本地 provider QA 都应通过 provider proxy。路线顺序建议已恢复为 `route_order_suggestion` server-side proxy operation；浏览器只发送当前日行程点 ID、标题和坐标，用户确认后才更新当前日排序。详见 [Provider Proxy](PROVIDER_PROXY.md)。

## Provider 数据合同

当前生成道路路线时，旅图把相邻行程点坐标发送给 TripMap 路线服务及其后端 Provider，不发送地点备注、票据或完整账号数据。路线顺序建议只把坐标发送给真实 Provider；标题和 ID 仅用于 TripMap proxy 归一化与确认展示。

目标响应必须归一化为具体 Provider、来源链接或标识、`observedAt`、`expiresAt`、适用交通方式、时区、告警和可恢复错误。过期路线不得继续显示为“实时”；动态信息不可用时应明确降级为静态估算或已有缓存。

## 路线边缘缓存

道路路线生成成功后，旅图会把最终可渲染的 polyline 保存到独立 IndexedDB：`TripMapRouteCacheDB`。这只是本机加速缓存：

- 不进入旅行完整 zip 归档。
- 不进入 Supabase 云端同步。
- 不进入 AI trip-plan import/export。
- 不保存 provider API key。
- 不缓存 OpenFreeMap tiles / glyph / sprite。

下次打开同一 Trip / Day 时，如果行程点坐标、顺序、交通模式和 provider 版本没有变化，地图会自动显示“本地缓存路线”。即使路线服务暂不可用，也可以查看已有缓存路线；服务不可用只会禁用重新生成。路线缓存 signature 不包含 API key、环境变量来源或 localStorage key 值。

如果地点坐标、排序、交通模式或路线算法版本变化，旧缓存会失效并删除，地图回到直线连接，用户可重新生成。清理路线缓存后，当前地图页会收到 `tripmap:route-cache-changed` 事件并回到直线连接。

设置页的“路线服务”区域可以查看缓存大小、设置上限和清理路线缓存。默认上限是 20 MB，可选 5 MB、20 MB、50 MB、100 MB。超过上限时会按最近使用时间清理旧缓存。

路线缓存只用于加快显示，不保证路线长期有效。出发前仍应以实际导航软件为准。

## 路线顺序建议

Trip Home 的“路线顺序建议”只在用户点击“查看建议（仅建议）”后调用 `route_order_suggestion`。真实 v1 使用 server-side Google Routes key 和 waypoint optimization；ORS optimization 暂不接入，因为它是单独的 public VROOM-backed endpoint。应用建议前必须再次确认，确认后只更新当前日 itinerary item 的 `sortOrder`，不生成路线、不写 route cache、不写云端、不创建票据。

## 交通模式映射

| 旅图交通方式 | OpenRouteService profile | 行为 |
| --- | --- | --- |
| `walk` | `foot-walking` | 请求步行路线 |
| `car` | `driving-car` | 请求驾车路线 |
| `bus` | `driving-car` | 公交段使用道路路线近似，不包含公交站点、班次、换乘和实时交通 |
| `cycling` | `cycling-regular` | 仅 routing 内部支持，当前业务枚举暂不持久化 |
| `other` / 未填写 | `driving-car` | 尝试驾车路线，并提示仅供参考 |
| `train` / `transit` / `flight` | 无 | 第一版直接显示直线 fallback |

公交近似只能帮助画出大致道路 polyline，不能代表公交站点、班次、换乘或实时交通。实际出行请以 Apple Maps / Google Maps 等导航为准。火车、公共交通和飞机段不会请求 ORS，继续使用直线 fallback。

## 失败回退

道路路线按相邻地点分段生成。某一段失败时，只将该段回退为直线；其他成功段继续显示道路路线。

常见错误：

- `401 / 403`：路线服务密钥无效或无权限。
- `429`：请求过于频繁或额度已用尽。
- `5xx`：路线服务暂时不可用。
- 超时或网络失败：网络异常或请求超时。

无论哪种失败，已缓存行程、marker、bottom sheet 和直线连接都应继续可用。
