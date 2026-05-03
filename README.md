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
- 添加到 iPhone 主屏幕，作为 PWA 使用

## ✨ 核心功能

- 旅行管理：创建、查看和删除本机旅行计划
- Day 时间轴：按天管理景点、酒店、餐厅和交通点
- MapLibre 地图视图：用 OpenFreeMap 底图显示当天地点、编号 marker 和直线顺序
- 手动交通段：记录步行、公共交通、火车、飞机等方式和备注
- 外部路线跳转：用 Apple Maps / Google Maps 查看上一站到当前站的路线
- 票据管理：
  - copy：保存文件副本到 IndexedDB，可离线查看并进入 zip 备份
  - reference：仅记录文件位置，不保存文件副本
  - external：保存外部链接，适合网盘、邮箱或订单网页
- zip 备份：导出和导入单个旅行的完整本机备份
- PWA：支持 iPhone Safari 添加到主屏幕，并缓存基础 app shell

## 🧱 技术栈

- React
- Vite
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- OpenFreeMap
- Dexie.js / IndexedDB
- JSZip
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
- Environment variables：不需要

项目使用 hash 路由，静态部署时不依赖服务器重写规则。

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
- 应用不会自动把数据上传到服务器。
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

## ⚠️ 当前限制

- 不提供真实路线规划。
- 不自动计算交通时间。
- 不做地点搜索和地理编码。
- 地图底图依赖 OpenFreeMap 网络加载。
- PWA 无法可靠保存并直接打开本地文件真实路径。
- iOS Safari 对 IndexedDB 存储有系统策略限制。
- 没有云同步、登录或后端服务。

## 项目状态

当前为个人使用型 PWA，优先 local-first。项目不包含后端、登录、云同步、Google Maps API、Mapbox token 或任何需要绑定账单的服务。

## License

License 尚未指定。
