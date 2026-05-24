# Supabase 云端保存备份与恢复

旅图 TripMap 的云端能力只做“账号登录 + 单旅行云端保存备份/恢复”。IndexedDB 仍是主数据源，Supabase 只保存旅行结构化数据和 copy 模式票据附件。

本功能不做实时同步、多设备冲突合并、多人协作或云端编辑。应用支持用户手动更新云端保存，也支持用户在设置页主动开启“自动云端保存”，在本地数据变化后延迟覆盖同一个云端保存。

## 为什么使用单旅行云端保存

- 当前本地数据以 Trip / Day / ItineraryItem / TicketMeta / TicketBlob 的完整旅行图为单位。
- copy 模式票据包含 Blob 文件，不适合逐字段实时同步。
- 恢复时使用云端保存里的 Trip ID；本地已有同 ID 旅行时，在用户确认后用云端版本覆盖该旅行图。
- 上传失败不会改变本地 IndexedDB 数据。
- 自动云端保存只是可选上传，不会做字段级合并。
- 从当前版本开始，同一用户的同一 `trip.id` 使用稳定 `backupId`，重复上传会覆盖同一个云端保存。
- 旧版本已经产生的多条云端记录或额外本地副本不会自动迁移、合并、删除或清理；用户可在设置页手动删除历史云端记录。
- 内部表字段、Storage 路径和文件名仍保留 `snapshot` 命名，用于兼容旧数据；当前用户界面统一呈现为一对一“云端保存”。

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

create policy "update own cloud backups"
on public.cloud_trip_backups
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "delete own cloud backups"
on public.cloud_trip_backups
for delete
to authenticated
using ((select auth.uid()) = user_id);
```

应用会通过稳定 `backupId` upsert 同一条 metadata，因此需要 update policy。

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

create policy "update own trip backup objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
)
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

## 云端保存文件格式（内部 snapshot.json）

内部 `snapshot.json` 不包含 Blob 或 base64。该文件名是兼容旧版实现的存储格式命名，不代表当前产品会为同一旅行创建新的快照列表：

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

- 恢复保留内部 `snapshot.json` 中的 Trip / Day / Item / Ticket id。
- 本地已有同 ID Trip 时，在一个 IndexedDB transaction 内替换该旅行的 Day / Item / Ticket / Blob 图。
- 本地没有同 ID Trip 时，按内部保存的原 ID 创建本地旅行。
- 恢复需要用户确认；确认后用云端版本覆盖当前本地旅行，不会自动合并本地修改。
- 恢复不会写入旧版云端恢复来源标签，也不会创建额外本地旅行。
- copy 附件下载失败时，仍恢复 TicketMeta，但跳过 TicketBlob 并返回 warning。
- 内部 `snapshot.json` 解析失败或引用结构损坏时阻止恢复。

## Cloudflare Pages

部署设置：

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

如果不配置环境变量，应用仍可使用本地 IndexedDB、zip 备份和 AI 行程包导入；SettingsPage 会显示云端保存未配置。

## 自动云端保存

设置页可以开启“自动云端保存”。开启后，旅图会在本地 Trip / Day / Item / Ticket 数据成功变更后，把对应旅行标记为待备份，并在用户已登录、Supabase 已配置、浏览器在线时延迟更新同一个云端保存。打开应用、恢复在线或登录状态变化时，也会补传本地更新或尚无云端保存的旅行。

需要注意：

- 默认关闭，必须由用户主动开启。
- 这是自动更新云端保存，不是实时同步。
- 云端版本较新时会提示使用云端版本覆盖同一 `trip.id` 的本地旅行。
- 不会合并多设备冲突。
- 本地版本较新时会上传本地版本并覆盖同一个云端保存。
- 可能双向修改时会提示用户手动选择用本地覆盖云端或用云端覆盖本地。
- 删除本地旅行不会自动删除云端保存；云端删除仍需要用户手动确认。
- 上传失败不会阻止本地编辑，只会保留待备份状态并显示“云端保存失败，可稍后重试”。
- 离开页面时会尝试立即 flush 待上传任务，并在仍有待上传/上传中任务时触发浏览器原生离开提示；浏览器关闭瞬间的网络请求不保证一定完成，下次打开会继续补偿。
- 本地 zip 备份仍建议保留，尤其是出发前的重要旅行。

## 隐私和安全

- 云端保存会上传旅行数据和 copy 模式票据文件到 Supabase。
- Supabase Auth 和 RLS 用于隔离用户数据。
- 第一版未做端到端加密。
- 护照、签证、银行卡、医疗资料等高度敏感文件请谨慎上传。
- 删除云端保存不会删除本地数据。
- 用云端版本覆盖本地会替换同一 `trip.id` 的本地旅行图。
- 本地 zip 备份仍建议保留，并保存到 iCloud Drive、OneDrive 或电脑本地。

## 常见问题

### 云端保存是不是云同步？

不是。它是单旅行云端保存备份。用户可以手动上传，也可以主动开启自动云端保存，让应用在本地变更后延迟覆盖同一个云端保存；但它不会实时同步，也不会自动合并多设备修改。

### reference / external 票据会上传文件吗？

不会。reference 只保存位置说明，external 只保存外部链接。

### copy 票据缺少本地 Blob 会怎样？

上传仍会继续，内部 `snapshot.json` 会保留票据元数据并返回 warning。恢复时会创建票据元数据，但不会生成 TicketBlob；后续预览时会显示文件内容缺失。
