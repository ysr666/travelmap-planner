# 旅行资料中心

## 范围

`#/documents` 是统一入口，包含证件、大交通和原票据附件。敏感字段及证件原件使用独立旅行资料库密钥加密；普通交通段、日期和时区保持可同步结构化数据。

- 证件 OCR、PDF 文本提取和交通票据预览只在本机运行。
- PNR、订单号、旅客关联、证件字段、文件名和原件内容均以密文同步。
- 禁止保存 CVV、账号密码、登录令牌或 Cookie。
- 航班动态目前只有 `disabled` 和测试用 `mock` provider，不会发起真实查询。
- `#/tickets` 会兼容跳转到资料中心附件页，旧票据不会被静默迁移。

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
