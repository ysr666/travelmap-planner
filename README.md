# 旅图 TripMap

旅图 TripMap 是一款本地优先的出国旅行 PWA，用于管理行程、地图路线、交通记录、票据文件和备份。

## 项目定位

旅图不是订票软件，也不是完整导航软件。它更像旅行总控台：在出发前整理每天安排，在路上快速查看地点、票据和交通备注，在需要时跳转到 Apple Maps 或 Google Maps 查看外部路线。

适合用来：

- 按天管理旅行行程
- 在地图上查看当天地点和路线顺序
- 手动记录从上一站到当前站的交通方式和预计耗时
- 保存或记录车票、门票、酒店订单、PDF、二维码截图
- 导出 / 导入完整 zip 备份
- 可选 Supabase 云端保存备份与恢复
- 添加到 iPhone 主屏幕，作为 PWA 使用

## ✨ 核心功能

- 旅行管理：创建、查看和删除本机旅行计划
- Day 时间轴：按天管理景点、酒店、餐厅和交通点
- MapLibre 地图视图：用 OpenFreeMap 底图显示当天地点、编号 marker、直线顺序，可选手动生成道路路线 polyline
- 手动交通段：记录步行、公共交通、火车、飞机等方式和备注
- 外部路线跳转：用 Apple Maps / Google Maps 查看上一站到当前站的路线
- 票据管理：
  - copy：保存文件副本到 IndexedDB，可离线查看并进入 zip 备份
  - reference：仅记录文件位置，不保存文件副本
  - external：保存外部链接，适合网盘、邮箱或订单网页
- zip 备份：导出和导入单个旅行的完整本机备份
- Supabase 云端保存：登录后手动更新同一旅行的云端保存，可选开启自动云端保存，并用云端版本原地更新本地旅行
- PWA：支持 iPhone Safari 添加到主屏幕，并缓存基础 app shell

## 🤖 使用外部 AI 生成行程

旅图不内置 AI，也不会调用 AI API。你可以使用 ChatGPT、Claude、Gemini、DeepSeek 或其他工具生成符合开放格式的 `trip-plan.json` / `trip-plan.zip`，再在设置页的“导入 AI 行程包”区域本地导入。

需要注意：

- AI 行程包导入用于新建旅行，不替代完整 zip 备份恢复。
- JSON 单文件适合导入行程、坐标、交通段、reference / external 票据。
- copy 模式真实附件必须使用 zip 行程包，并把文件放在 zip 内 `files/` 目录；`filePath` 必须是 `files/` 下的安全相对路径。
- AI 可能生成错误地点、错误坐标或错误时间，导入前后都需要人工核对。
- 导入预览会区分“必须修复”和“建议检查”；有建议检查时仍可导入，但导入后应逐项核对。

文档：

- [AI 行程包开放格式](docs/AI_IMPORT_SPEC.md)
- [外部 AI 提示词模板](docs/AI_PROMPT_TEMPLATE.md)
- [trip-plan 示例](examples/README.md)

## 🧱 技术栈

- React
- Vite
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- OpenFreeMap
- Dexie.js / IndexedDB
- JSZip
- Supabase
- vite-plugin-pwa

## 🚀 本地开发

```bash
npm install
npm run dev
```

开发地址通常是：

[http://localhost:5173/#/home](http://localhost:5173/#/home)

如果示例旅行坐标显示异常，请删除旧示例旅行，或清空浏览器里的 `TravelConsoleDB` 后重新点击“创建示例旅行”。已存在于 IndexedDB 的旧示例数据不会自动更新。

## 🏗 构建和预览

```bash
npm run build
npm run preview
```

生产预览地址通常是：

[http://localhost:4173/#/home](http://localhost:4173/#/home)

## ☁️ Cloudflare Pages 部署

推荐配置：

- Framework preset：React (Vite) 或 None
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：`/`
- Environment variables：如果启用云端保存，需要配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；如果启用生产路线服务，需要配置 `VITE_ROUTE_PROXY_URL` 和 `VITE_ROUTE_PROXY_PROVIDER`，并在后端运行时配置 provider secrets。

项目使用 hash 路由，静态部署时不依赖服务器重写规则。

## ☁️ Supabase 云端保存

旅图可以选择接入 Supabase，用于账号登录后的单旅行云端保存备份和恢复。它不是实时同步：不会合并多设备冲突，也不会多人协作。你可以手动上传本地数据，也可以在设置页主动开启“自动云端保存”，让旅图在本机数据变化后延迟更新同一个云端保存。

登录且在线时，旅图会比较本地旅行版本信号与最新云端保存 metadata。云端较新时会用云端版本原地更新本地旅行；本地较新且自动云端保存已开启时会补传本地版本；可能双向修改时会提示用户手动选择。

需要配置：

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

云端保存和本地 zip 的区别：

- 本地 zip：完全在本机生成，适合出发前保存到 iCloud Drive、OneDrive 或电脑本地。
- 云端保存：上传旅行结构化数据和 copy 模式票据附件到 Supabase，适合换设备或清空浏览器后的恢复。同一 `trip.id` 重复上传会更新同一个云端保存。
- 自动云端保存：在本机数据变化后自动补传同一个云端保存；可能双向修改时不会静默合并。
- 用云端保存更新本地会原地替换同一 `trip.id` 的本地旅行图，不创建新的旅行副本。
- 第一版未做端到端加密，护照、签证、银行卡等高度敏感文件请谨慎上传。

Supabase 建表、RLS 和 Storage policy 见 [Supabase 云端保存配置](docs/SUPABASE_CLOUD_BACKUP.md)。

## 🗺️ 道路路线 Polyline

地图默认使用直线连接当天地点。配置 TripMap provider proxy 后，在地图页手动点击“生成道路路线”，旅图会按相邻地点请求道路路线 polyline。失败、超时、额度不足或交通模式不支持时，会回退显示直线。

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

Provider secrets 只应配置在后端运行时，例如 Cloudflare Pages Function 的 env binding。不要把 OpenRouteService、Google Routes 或未来 AI provider secrets 放进 `VITE_*` 变量，也不要要求用户在设置页填写 key。浏览器可见的 Google Maps JavaScript 渲染 key 是另一类公开受限 key，应使用 referrer 限制，不能当作 server-only Routes key。

道路路线生成成功后会保存为本地路线缓存，只存在当前浏览器的独立 `TripMapRouteCacheDB` 中，不进入 zip 备份、Supabase 云备份或 AI 行程包。下次打开同一旅行和同一天时，如果地点坐标、顺序和交通方式没有变化，地图会自动显示“本地缓存路线”；即使路线服务暂不可用，也可以查看已有缓存，但不能重新生成。修改地点坐标、顺序或交通方式后，旧路线缓存会失效并删除。设置页可以查看缓存大小、设置上限并清理缓存。

公交段会使用驾车道路路线做近似，不包含公交站点、班次、换乘和实时交通；火车、公共交通和飞机段仍使用直线 fallback。

道路路线不是实时导航，不包含实时交通。生成路线时会把地点坐标发送给 TripMap 路线服务及其后端 provider。详细说明见 [地图道路路线 Polyline](docs/ROUTING.md) 和 [Provider Proxy](docs/PROVIDER_PROXY.md)。

## 📱 iPhone 添加到主屏幕

1. 用 Safari 打开部署地址，例如 `https://travelmap-planner.pages.dev/#/home`
2. 点击分享按钮
3. 选择“添加到主屏幕”
4. 名称可设为“旅图”

## 🔐 数据与隐私说明

- 数据默认保存在当前浏览器的 IndexedDB 中。
- copy 模式会把票据文件副本保存到本地浏览器存储。
- reference 模式不会保存文件副本，只记录你填写的位置说明。
- external 模式只保存外部链接。
- 应用不会默认把数据上传到服务器；只有用户手动上传本地数据，或主动开启“自动云端保存”后，才会上传到 Supabase。
- 道路路线仅在用户手动点击生成时请求第三方路线服务，并会发送相邻地点坐标。
- 道路路线缓存只保存在当前浏览器本机，不上传云端，也不进入 zip 备份。
- 清除浏览器数据、私密浏览、系统存储压力或长期未使用都可能导致本地数据丢失。
- 出发前必须把重要旅行导出 zip 备份，并保存到 iCloud Drive、OneDrive 或电脑本地。

## 📦 备份说明

zip 备份包含：

- 旅行信息
- Day 列表
- 行程点、坐标和交通段
- 票据元数据
- copy 模式票据文件

reference / external 模式不会包含实际文件内容，只会保留位置说明或外部链接。可以在设置页导入 zip 备份恢复旅行。

道路路线缓存不会进入 zip 备份。恢复旅行后如需道路路线，需要重新生成，或依赖当前浏览器已有的匹配本地缓存。

## ⚠️ 当前限制

- 道路路线 polyline 不是实时导航，不提供语音导航、turn-by-turn 指令或实时交通。
- 不自动计算交通时间。
- 不做地点搜索和地理编码。
- 地图底图依赖 OpenFreeMap 网络加载。
- PWA 无法可靠保存并直接打开本地文件真实路径。
- iOS Safari 对 IndexedDB 存储有系统策略限制。
- Supabase 云端保存不是实时同步，不做字段级合并；可能双向修改时需要用户手动选择。

## 项目状态

当前为 local-first PWA，优先保护本机数据边界。项目可选接入 Supabase 云端保存、TripMap provider proxy 路线服务和浏览器可见的 Google Maps JS 渲染 key；server-only Google Routes / OpenRouteService / future AI keys 不应进入前端 bundle 或用户设置页。

设计原则：轻量化不是删内容，而是更清楚的信息层级、更少空壳、更自然的分组。

当前路线图与阶段状态见：

- [项目状态](docs/PROJECT_STATUS.md)
- [路线图 v4](docs/ROADMAP_V4.md)

## License

License 尚未指定。
