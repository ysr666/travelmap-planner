# Supabase 云端备份与恢复

旅图 TripMap 的第一版云端能力只做“账号登录 + 云端快照备份/恢复”。IndexedDB 仍是主数据源，Supabase 只保存用户主动上传的旅行快照和 copy 模式票据附件。

本功能不做实时同步、自动后台同步、多设备冲突合并、多人协作或云端编辑。

## 为什么使用快照备份

- 当前本地数据以 Trip / Day / ItineraryItem / TicketMeta / TicketBlob 的完整旅行图为单位。
- copy 模式票据包含 Blob 文件，不适合逐字段实时同步。
- 恢复时创建新的本地 Trip，可以避免覆盖和冲突。
- 上传失败不会改变本地 IndexedDB 数据。

## 环境变量

本地 `.env.local` 或 Cloudflare Pages 环境变量：

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

不要把 service role key 放进前端。前端只使用 anon key，并依赖 Supabase Auth + RLS 隔离用户数据。

## 数据表

```sql
create table if not exists public.cloud_trip_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_trip_id text,
  title text not null,
  destination text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exported_at timestamptz not null,
  app_version text,
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot_path text not null,
  files_count integer not null default 0 check (files_count >= 0),
  total_size_bytes bigint not null default 0 check (total_size_bytes >= 0),
  warnings jsonb,
  notes text
);

create unique index if not exists cloud_trip_backups_user_snapshot_unique
  on public.cloud_trip_backups (user_id, snapshot_path);

create index if not exists cloud_trip_backups_user_updated_idx
  on public.cloud_trip_backups (user_id, updated_at desc);
```

可选更新时间触发器：

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cloud_trip_backups_set_updated_at on public.cloud_trip_backups;

create trigger cloud_trip_backups_set_updated_at
before update on public.cloud_trip_backups
for each row execute function public.set_updated_at();
```

## RLS policy

```sql
alter table public.cloud_trip_backups enable row level security;

create policy "select own cloud backups"
on public.cloud_trip_backups
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "insert own cloud backups"
on public.cloud_trip_backups
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "delete own cloud backups"
on public.cloud_trip_backups
for delete
to authenticated
using ((select auth.uid()) = user_id);
```

第一版应用不会更新云端备份 metadata，因此不需要 update policy。

## Storage bucket

创建私有 bucket：

```sql
insert into storage.buckets (id, name, public)
values ('trip-backups', 'trip-backups', false)
on conflict (id) do nothing;
```

对象路径固定为：

```text
{userId}/{backupId}/snapshot.json
{userId}/{backupId}/files/{ticketId}/{safeFileName}
```

Storage policy 使用用户 id 作为第一段路径：

```sql
create policy "read own trip backup objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

create policy "insert own trip backup objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

create policy "delete own trip backup objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);
```

不要把 bucket 设为 public。

## Cloud snapshot 格式

`snapshot.json` 不包含 Blob 或 base64：

```json
{
  "schemaVersion": 1,
  "type": "cloud-trip-backup",
  "appName": "旅图",
  "exportedAt": "2026-05-06T10:00:00.000Z",
  "appVersion": "0.2.0.2",
  "originalTripId": "trip_xxx",
  "trip": {},
  "days": [],
  "itineraryItems": [],
  "ticketMetas": [],
  "fileRefs": [
    {
      "ticketId": "ticket_xxx",
      "path": "userId/backupId/files/ticket_xxx/order.pdf",
      "fileName": "order.pdf",
      "mimeType": "application/pdf",
      "size": 12345
    }
  ],
  "warnings": []
}
```

copy 票据附件上传到 Storage；reference / external 票据只保存元数据。

## 恢复规则

- 恢复永远创建新的本地 Trip。
- 不覆盖已有 IndexedDB 数据。
- 恢复时生成新的 Trip / Day / Item / Ticket id，并重写所有引用。
- copy 附件下载失败时，仍恢复 TicketMeta，但跳过 TicketBlob 并返回 warning。
- snapshot 解析失败或引用结构损坏时阻止恢复。

## Cloudflare Pages

部署设置：

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

如果不配置环境变量，应用仍可使用本地 IndexedDB、zip 备份和 AI 行程包导入；SettingsPage 会显示云端备份未配置。

## 隐私和安全

- 云端备份会上传旅行数据和 copy 模式票据文件到 Supabase。
- Supabase Auth 和 RLS 用于隔离用户数据。
- 第一版未做端到端加密。
- 护照、签证、银行卡、医疗资料等高度敏感文件请谨慎上传。
- 删除云端备份不会删除本地数据。
- 恢复云端备份不会覆盖本地数据。
- 本地 zip 备份仍建议保留，并保存到 iCloud Drive、OneDrive 或电脑本地。

## 常见问题

### 云端备份是不是云同步？

不是。它是用户手动上传和恢复的快照，不会实时同步，也不会自动合并多设备修改。

### reference / external 票据会上传文件吗？

不会。reference 只保存位置说明，external 只保存外部链接。

### copy 票据缺少本地 Blob 会怎样？

上传仍会继续，snapshot 会保留票据元数据并返回 warning。恢复时会创建票据元数据，但不会生成 TicketBlob；后续预览时会显示文件内容缺失。
