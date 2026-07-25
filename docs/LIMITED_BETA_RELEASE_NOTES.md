# Limited Beta 发布说明

版本：0.4.0.1
版本日期：2026-07-26

## 本轮完成

- 页面信息层级收敛：行程时间轴和票据画廊优先；每日助手、实时行程、设置二级项和新增票据默认收起。
- 票据画廊使用真实图片缩略图，长票据名、地点和地址在移动端正确换行。
- 全局 AI 可直接打开票据画廊或匹配票据，完成导航后自动收起；明确修改继续走预览与确认。
- 通用 AI Action Gateway V1 登记票据打开、地点补全和行程修复；Provider 不能选择任意函数或敏感字段，写入保留一次最终确认和 stale-state 保护。
- 地点查询打开后自动搜索当前行程点，候选确认后才写入。
- 行程智能一键修复继续统一处理可自动修复项，高风险内容保留确认。
- PWA 更新改为提示用户刷新，不再在发现新版本时立即重载。
- 设置页显示应用版本和短提交 SHA，方便确认当前部署。
- CI 现在真实检查前端、Pages provider runtime 和 Travel Inbox Worker，并保留 E2E 失败 artifacts。
- Supabase 补齐账号 AI 偏好表、RLS、私有 trigger、授权和 Companion 票据外键索引。
- 全局 AI 与 Provider 客户端移出静态启动图，PDF 恢复按需加载，并新增 CI bundle budget。
- Service Worker 预缓存从约 4.15 MiB 降至约 2.28 MiB；地图、PDF/OCR、JSZip 和 AI 重资源改为首次使用后缓存。

## 验证

- TypeScript、lint、build 全部通过。
- Unit：185 个文件、1472 个测试通过。
- Playwright：141 个全量测试通过。
- PWA built-dist：2 个测试通过，覆盖升级保留 IndexedDB、核心离线页和可选资源按需缓存。
- Bundle：入口 JS 从 947.6 kB 降至 476.9 kB；初始静态 JS gzip 244.8 KiB。
- Supabase 空库重建和生产 post-DDL SQL 检查通过。

## 已知限制

- Action Gateway V1 当前只登记票据、地点和行程修复，不是可以任意调用所有内部能力的自主代理。
- 实时事实需要来源；路线是预览，不是实时导航。
- 地图、provider、搜索和云同步不保证离线可用。
- iPhone Safari、iOS 主屏 PWA 与 Android Chrome 实体机结果仍需人工补录。
- MapLibre 首次使用仍需网络；弱网中断恢复和多标签升级仍需继续验证。

## 回滚

- 前端回滚到上一 Cloudflare Pages 生产部署。
- Provider 可通过 D1 control 关闭 `global`、`ai`、`search`、`place`、`route` 或 `fx`。
- 数据库继续使用前向 migration，不删除现有用户数据。
- 发现 provider secret 泄露时先轮换，再恢复服务。
