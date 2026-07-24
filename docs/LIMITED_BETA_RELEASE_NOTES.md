# Limited Beta 发布说明

版本：0.4.0.1
版本日期：2026-07-24

## 本轮完成

- 页面信息层级收敛：行程时间轴和票据画廊优先；每日助手、实时行程、设置二级项和新增票据默认收起。
- 票据画廊使用真实图片缩略图，长票据名、地点和地址在移动端正确换行。
- 全局 AI 可直接打开票据画廊或匹配票据，完成导航后自动收起；明确修改继续走预览与确认。
- 地点查询打开后自动搜索当前行程点，候选确认后才写入。
- 行程智能一键修复继续统一处理可自动修复项，高风险内容保留确认。
- PWA 更新改为提示用户刷新，不再在发现新版本时立即重载。
- 设置页显示应用版本和短提交 SHA，方便确认当前部署。
- CI 现在真实检查前端、Pages provider runtime 和 Travel Inbox Worker，并保留 E2E 失败 artifacts。
- Supabase 补齐账号 AI 偏好表、RLS、私有 trigger、授权和 Companion 票据外键索引。

## 验证

- TypeScript、lint、build 全部通过。
- Unit：180 个文件、1447 个测试通过。
- Playwright：137 个全量测试通过。
- PWA built-dist 升级：1 个测试通过，IndexedDB 保留。
- Supabase 空库重建和生产 post-DDL SQL 检查通过。

## 已知限制

- 全局 AI 当前是受控动作目录，不是可以任意调用所有内部能力的自主代理。
- 实时事实需要来源；路线是预览，不是实时导航。
- 地图、provider、搜索和云同步不保证离线可用。
- iPhone Safari、iOS 主屏 PWA 与 Android Chrome 实体机结果仍需人工补录。
- 主应用、MapLibre、OCR/PDF chunk 后续会专项拆分。

## 回滚

- 前端回滚到上一 Cloudflare Pages 生产部署。
- Provider 可通过 D1 control 关闭 `global`、`ai`、`search`、`place`、`route` 或 `fx`。
- 数据库继续使用前向 migration，不删除现有用户数据。
- 发现 provider secret 泄露时先轮换，再恢复服务。
