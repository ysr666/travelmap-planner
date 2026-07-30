# 旅行资料中心

状态：**Current data contract + Target UI V3**

旅行资料中心是在线行程中的统一资料与票据入口，也是 AI Action Gateway 查找、打开、识别和关联旅行文件的权威上下文。默认界面只呈现缩略图、名称、状态和当前任务，复杂元数据按需展开。

目标界面遵守 [UI V3 重构规范](UI_REFACTOR_V3.md)：

- 页面打开后首先显示真实缩略图画廊，不先显示统计、设置、连接器或新增表单。
- 图片和二维码使用真实缩略图；PDF 使用第一页预览；其他文件使用克制的文件行。
- 添加使用标题栏加号，筛选和排序进入 Sheet，零数量分类默认隐藏。
- 文档列表名称最多两行，详情完整展示；任何文件名都不能造成横向溢出。
- 精确 AI 匹配直接打开原件并关闭 AI；宽泛或无匹配查询进入当前旅行的画廊。

## 目标与当前范围

**目标：** 原始附件与结构化元数据在线同步，设备按需缓存；AI 可以通过登记动作完成票据检索、文档识别、订单关联、航班或列车状态核验以及变更建议。精确票据匹配直接打开原件，宽泛查询进入缩略图画廊，所有动态状态均显示来源和更新时间。

**当前：** `#/documents` 已统一证件、大交通和原票据附件；OCR、PDF 文本提取和交通票据预览仍在本机运行，航班动态只有 `disabled` 和测试用 `mock` Provider。旧 `#/tickets` 会兼容跳转到资料中心附件页。

当前数据合同：

- PNR、订单号、旅客关联、证件字段、文件名和原件内容均以密文同步。
- 禁止保存 CVV、账号密码、登录令牌或 Cookie。
- 敏感字段及证件原件使用独立旅行资料库密钥加密；普通交通段、日期、时区、来源和状态保持可同步结构化数据。
- 文档内容只能进入声明了字段白名单、用途和保留期的 AI 动作；Provider 不得接收资料库密钥或任意附件集合。

## Supabase 部署

1. 应用 `supabase/migrations/20260611143000_travel_document_center.sql`。
2. 部署 `push-reminders` Edge Function；该函数使用独立 cron secret，因此 `verify_jwt=false`。
3. 配置 Edge Function secrets：

```bash
supabase secrets set \
  TRIPMAP_REMINDER_CRON_SECRET='<random-secret>' \
  VAPID_PUBLIC_KEY='<public-key>' \
  VAPID_PRIVATE_KEY='<private-key>' \
  VAPID_SUBJECT='mailto:admin@example.com'
```

4. 在前端构建环境配置相同的 `VITE_WEB_PUSH_PUBLIC_KEY`。
5. 将定时调用所需值写入 Supabase Vault，名称必须为：

```text
tripmap_project_url
tripmap_anon_key
tripmap_reminder_cron_secret
```

其中 `tripmap_reminder_cron_secret` 必须与 Edge Function secret 相同。服务端只读取提醒时间、通用类型、用户 ID 和随机对象 ID；推送正文不包含姓名、国家、证件号或 PNR。

## 恢复与冲突

- “加密备份”导出的 ZIP 只包含密钥信封、密文对象和密文附件，恢复后仍需原恢复口令。
- 恢复包只能导入没有现存旅行资料库的设备，避免无提示覆盖。
- 加密对象冲突按整项选择本机或云端版本，不对密文做字段级合并。
- 原旅行云同步表及“一次旅行对应一份云端保存”的语义保持不变。

## 验证

```bash
npm run build
npm run lint
npm run test:unit
npx playwright test e2e/travel-document-center.spec.ts e2e/ticket-library.spec.ts --workers=1
deno check --node-modules-dir=auto supabase/functions/push-reminders/index.ts
```

自动测试不得调用真实航班、AI、搜索、路线或云端服务。
