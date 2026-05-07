# 地图道路路线 Polyline

旅图默认使用本地直线连接当天行程点。配置路线服务后，可以在地图页手动生成道路路线 polyline。

## 功能边界

- 这不是实时导航。
- 不提供语音导航或 turn-by-turn 指令。
- 不包含实时交通。
- 不做地点搜索、地理编码或自动补坐标。
- 不支持离线路线。
- 路线生成失败时，旅图会回退到直线连接。

## Provider

第一版支持 OpenRouteService。

本地开发或个人部署可以在环境变量中配置：

```env
VITE_ROUTING_PROVIDER=openrouteservice
VITE_OPENROUTESERVICE_API_KEY=your_openrouteservice_key
```

也可以在设置页的“路线服务”中填写本机 API key。这个 key 只保存在当前浏览器 `localStorage`，不会进入 IndexedDB、zip 备份、Supabase 云备份或 AI 行程包。

## 前端 Key 风险

`VITE_OPENROUTESERVICE_API_KEY` 会被 Vite 打进前端 bundle。个人部署通常可以接受；公开部署不建议把 provider key 放进前端。未来如果要做公开服务，应使用后端代理或边缘函数保存 key，并配合限流。

本阶段不实现后端代理。

## 隐私说明

生成道路路线时，旅图会把相邻行程点的坐标发送给 OpenRouteService。旅图不会发送地点标题、地址、备注、票据或用户账号信息。

路线服务、地图底图和外部 Apple / Google Maps 链接都由第三方提供。出发前请以实际导航软件和官方交通信息为准。

## 交通模式映射

| 旅图交通方式 | OpenRouteService profile | 行为 |
| --- | --- | --- |
| `walk` | `foot-walking` | 请求步行路线 |
| `car` | `driving-car` | 请求驾车路线 |
| `cycling` | `cycling-regular` | 仅 routing 内部支持，当前业务枚举暂不持久化 |
| `other` / 未填写 | `driving-car` | 尝试驾车路线，并提示仅供参考 |
| `train` / `transit` / `flight` | 无 | 第一版直接显示直线 fallback |

## 失败回退

道路路线按相邻地点分段生成。某一段失败时，只将该段回退为直线；其他成功段继续显示道路路线。

常见错误：

- `401 / 403`：路线服务密钥无效或无权限。
- `429`：请求过于频繁或额度已用尽。
- `5xx`：路线服务暂时不可用。
- 超时或网络失败：网络异常或请求超时。

无论哪种失败，地图本地行程、marker、bottom sheet 和直线连接都应继续可用。
