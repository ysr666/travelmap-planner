# Supabase 云端同步与恢复

旅图 TripMap 的云端能力是“离线可用 + 账号登录后自动同步”。IndexedDB 是此设备的离线缓存与首写层，Supabase 保存旅行结构化数据和已保存票据文件，用于跨设备延续和恢复。

本功能不做实时协作、多人协作或云端编辑。用户写入成功后会进入同步队列；同步会先拉取账号对象，不同对象和不同字段会自动合并，同一字段双边修改或删除/更新冲突会进入确认面板。

## 当前同步架构

旅图现在采用对象同步优先、snapshot 兼容保留的混合架构：

- Trip / Day / ItineraryItem / TicketMeta 进入对象级同步表。
- copy 票据文件进入独立票据 Blob 记录和 Storage 路径。
- 旧 `cloud_trip_backups` / `snapshot.json` 继续保留，用于旧账号数据恢复、迁移和兼容回滚。
- 如果对象同步表尚未部署，应用会退回旧 snapshot 同步；此时不会开放“清理已同步票据缓存”。

## 兼容 snapshot 同步

- 此设备数据以 Trip / Day / ItineraryItem / TicketMeta / TicketBlob 的完整旅行图为单位。
- copy 模式票据包含 Blob 文件，不适合逐字段实时同步。
- 恢复时使用账号数据里的 Trip ID；此设备已有同 ID 旅行时，在用户确认后用账号数据更新该旅行图。
- 同步失败不会改变此设备 IndexedDB 数据。
- 兼容 snapshot 路径不会做字段级合并；字段级冲突合并只在对象同步表可用时启用。
- 从当前版本开始，同一用户的同一 `trip.id` 使用稳定 `backupId`，重复同步会覆盖同一个云端同步记录。
- 旧版本已经产生的多条云端记录或额外离线缓存不会自动迁移、合并、删除或清理；用户可在设置页手动删除历史云端记录。
- 内部表字段、Storage 路径和文件名仍保留 `snapshot` 命名，用于兼容旧数据；当前用户界面统一呈现为一对一“云端同步”。

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

对象同步表：

```sql
create table if not exists public.cloud_sync_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  object_type text not null check (object_type in ('trip', 'day', 'item', 'ticket_meta')),
  object_id text not null,
  payload jsonb,
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  deleted_at_ms bigint,
  device_id text not null,
  op_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, object_type, object_id)
);

create index if not exists cloud_sync_objects_user_trip_idx
  on public.cloud_sync_objects (user_id, trip_id, updated_at_ms desc);

create table if not exists public.cloud_ticket_blobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  ticket_id text not null,
  storage_path text not null,
  sha256 text not null,
  mime_type text not null,
  size bigint not null check (size >= 0),
  file_name text not null,
  uploaded_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

create index if not exists cloud_ticket_blobs_user_trip_idx
  on public.cloud_ticket_blobs (user_id, trip_id, uploaded_at desc);
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

alter table public.cloud_sync_objects enable row level security;
alter table public.cloud_ticket_blobs enable row level security;

create policy "select own sync objects"
on public.cloud_sync_objects
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "insert own sync objects"
on public.cloud_sync_objects
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "update own sync objects"
on public.cloud_sync_objects
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "delete own sync objects"
on public.cloud_sync_objects
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "select own ticket blobs"
on public.cloud_ticket_blobs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "insert own ticket blobs"
on public.cloud_ticket_blobs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "update own ticket blobs"
on public.cloud_ticket_blobs
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "delete own ticket blobs"
on public.cloud_ticket_blobs
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
{userId}/objects/{tripId}/tickets/{ticketId}/{sha256}-{safeFileName}
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

## 对象同步规则

- 本地写入先进入 IndexedDB，再写入对象 outbox。
- 自动同步会先拉取账号对象，再对比本地 outbox、共同基线和账号 payload；不会在常规同步时先用此设备完整旅行图覆盖账号数据。
- 不同对象可自动合并；同一对象的不同字段可三方自动合并。
- 同一字段在此设备和账号都从共同基线改成不同值时，写入 `objectSyncConflicts`，用户在冲突面板选择“此设备版本 / 账号版本”；notes 字段若是追加式修改会自动合并，否则可选择“合并两边备注”。
- 本机删除但账号更新、账号删除但本机更新时进入删除冲突，用户选择“删除对象”或“保留对象版本”。
- TicketMeta 删除会写 tombstone；copy 票据 Blob 会删除 Storage 文件并标记 `cloud_ticket_blobs.deleted_at`。

## 票据 Blob 独立同步与离线缓存

- copy 票据保存后会先写 `ticketBlobs`，状态为 `pending/cached`。
- 上传成功后写 `cloud_ticket_blobs`，状态为 `synced/cached`。
- “清理离线缓存”只删除此设备 `ticketBlobs`，不删除 TicketMeta 或云端 Blob。
- “重新同步票据文件”按 `cloud_ticket_blobs.storage_path` 下载并恢复此设备缓存。
- 未登录、离线、自动同步关闭、上传失败或没有云端引用时，不允许清理唯一票据文件。

## 云端同步文件格式（内部 snapshot.json）

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
- 恢复需要用户确认；确认后用账号数据覆盖此设备旅行，当前方向操作不会自动合并此设备中的未选修改。
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

如果不配置环境变量，应用仍可使用本地 IndexedDB、zip 归档和 AI 行程包导入；SettingsPage 会显示云端同步未配置。

## 自动云端同步

自动云端同步默认开启，用户可在设置页关闭。开启时，旅图会在 Trip / Day / Item / Ticket / AI 应用 / 导入 / 内容补充 / 备注追加等写入成功后，把对应旅行标记为待同步，并在用户已登录、Supabase 已配置、浏览器在线时延迟更新同一个云端同步记录。打开应用、恢复在线或登录状态变化时，也会补传此设备更新或尚无云端同步记录的旅行。

需要注意：

- 用户关闭自动同步后，写入仍会保存在此设备离线缓存中。
- 这是自动同步队列，不是实时协作。
- 账号数据较新时会提示同步账号数据到此设备。
- 登录后会根据本机/账号旅行数量提示“正在同步到账号”“正在同步到此设备”或“正在检查账号数据”，用户不需要理解内部 snapshot 路径。
- 设置页会轻量显示待同步项、上次同步时间和票据文件上传状态；这是状态摘要，不是高级同步控制台。
- 不同对象和不同字段会自动合并；同一字段双边不同修改或删除/更新冲突会进入确认面板。
- 此设备版本较新时会同步此设备版本并覆盖同一个云端同步记录。
- 可能双向修改时会提示用户选择同步方向。
- 删除本地旅行不会自动删除云端同步；云端删除仍需要用户手动确认。
- 同步失败不会阻止本地编辑，只会保留待同步状态并显示“云端同步失败，可稍后重试”。
- 离开页面时会尝试立即 flush 待同步任务，并在仍有待同步/同步中任务时触发浏览器原生离开提示；浏览器关闭瞬间的网络请求不保证一定完成，下次打开会继续补偿。
- zip 归档是可选的离线归档能力，适合用户主动留存文件。

## 迁移和回滚

- 先部署新表和 RLS，再发布前端。
- 前端检测对象表不可用时自动 fallback 到旧 snapshot 同步。
- 回滚前端不会破坏新对象表；旧 snapshot 路径仍可继续恢复。
- 不要手动清理 `{userId}/objects/...` Storage 文件，除非同时处理 `cloud_ticket_blobs`。
- 旧 snapshot 附件仍可恢复；新对象同步成功后，票据长期来源以 `cloud_ticket_blobs` 为准。

## 隐私和安全

- 云端同步会同步旅行数据和已保存票据文件到 Supabase。
- Supabase Auth 和 RLS 用于隔离用户数据。
- 第一版未做端到端加密。
- 护照、签证、银行卡、医疗资料等高度敏感文件请谨慎上传。
- 删除云端同步记录不会删除此设备数据。
- 同步账号数据到此设备会替换同一 `trip.id` 的离线缓存。
- zip 归档可按需保存到 iCloud Drive、OneDrive 或电脑。

## 常见问题

### 云端同步是不是实时协作？

不是。它是单旅行账号同步：写入先落到此设备离线缓存，再通过自动同步队列更新账号对象；它不会实时协作，但会做 pull-before-push 增量合并。同一字段双边不同修改会停在冲突面板等待用户确认。

### reference / external 票据会上传文件吗？

不会。reference 只保存位置说明，external 只保存外部链接。

### copy 票据缺少本地 Blob 会怎样？

上传仍会继续，内部 `snapshot.json` 会保留票据元数据并返回 warning。恢复时会创建票据元数据，但不会生成 TicketBlob；后续预览时会显示离线缓存不可用，并提示重新同步账号数据或重新上传票据。
