# 地图道路路线 Polyline

旅图默认使用本地直线连接当天行程点。配置路线服务后，可以在地图页手动生成道路路线 polyline。

## 功能边界

- 这不是实时导航。
- 不提供语音导航或 turn-by-turn 指令。
- 不包含实时交通。
- 不做地点搜索、地理编码或自动补坐标。
- 不支持离线路线。
- 路线生成失败时，旅图会回退到直线连接。

## Provider Proxy

生产路线服务应通过 TripMap provider proxy 调用后端 provider。前端只知道 proxy URL 和用于 route cache identity 的具体 provider，不保存也不展示 provider secrets。

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

Cloudflare Pages Function 入口为 `functions/api/provider-proxy.ts`。OpenRouteService、Google Routes 和 AI provider secrets 只应来自后端运行时 env binding，例如 `OPENROUTESERVICE_API_KEY`、`GOOGLE_ROUTES_API_KEY` 和 `TRIPMAP_AI_API_KEY`。

浏览器可见的 Google Maps JavaScript 渲染 key 是另一类公开受限 key，应在 Google Cloud Console 通过 referrer 限制。它只用于地图渲染和浏览器端 Google Maps JS 能力，不能替代 server-only Google Routes 或 Google Places key。

## 前端 Key 风险

不要把 `OPENROUTESERVICE_API_KEY`、`GOOGLE_ROUTES_API_KEY` 或 AI provider secrets 放进任何 `VITE_*` 变量。`VITE_*` 会进入前端 bundle。Settings 不提供 Google/ORS/AI key 输入、保存、清除或展示控件。

前端不再使用 `VITE_OPENROUTESERVICE_API_KEY`、旧 ORS localStorage key，或 Google Maps JS key 直接调用 OpenRouteService / Google Routes。公开部署和本地 provider QA 都应通过 provider proxy。路线顺序建议暂时停用，直到它有独立的 server-side proxy operation。详见 [Provider Proxy](PROVIDER_PROXY.md)。

## 隐私说明

生成道路路线时，旅图会把相邻行程点的坐标发送给 TripMap 路线服务及其后端 provider。旅图不会发送地点标题、地址、备注、票据或用户账号信息。

路线服务、地图底图和外部 Apple / Google Maps 链接都由第三方提供。出发前请以实际导航软件和官方交通信息为准。

## 本地路线缓存

道路路线生成成功后，旅图会把最终可渲染的 polyline 保存到独立 IndexedDB：`TripMapRouteCacheDB`。这只是本机加速缓存：

- 不进入旅行完整 zip 备份。
- 不上传到 Supabase 云端保存。
- 不进入 AI trip-plan import/export。
- 不保存 provider API key。
- 不缓存 OpenFreeMap tiles / glyph / sprite。

下次打开同一 Trip / Day 时，如果行程点坐标、顺序、交通模式和 provider 版本没有变化，地图会自动显示“本地缓存路线”。即使路线服务暂不可用，也可以查看已有缓存路线；服务不可用只会禁用重新生成。路线缓存 signature 不包含 API key、环境变量来源或 localStorage key 值。

如果地点坐标、排序、交通模式或路线算法版本变化，旧缓存会失效并删除，地图回到直线连接，用户可重新生成。清理路线缓存后，当前地图页会收到 `tripmap:route-cache-changed` 事件并回到直线连接。

设置页的“路线服务”区域可以查看缓存大小、设置上限和清理路线缓存。默认上限是 20 MB，可选 5 MB、20 MB、50 MB、100 MB。超过上限时会按最近使用时间清理旧缓存。

路线缓存只用于加快显示，不保证路线长期有效。出发前仍应以实际导航软件为准。

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

无论哪种失败，地图本地行程、marker、bottom sheet 和直线连接都应继续可用。
