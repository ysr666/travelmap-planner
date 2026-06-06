# Supabase 云端同步与恢复

旅图 TripMap 的云端能力是“离线可用 + 账号登录后自动同步”。IndexedDB 是此设备的离线缓存与首写层，Supabase 保存旅行结构化数据和已保存票据文件，用于跨设备延续和恢复。

本功能不做实时协作、多设备字段级冲突合并、多人协作或云端编辑。用户写入成功后会进入同步队列；设置页仍提供“立即同步”和方向确认，用于明确处理账号数据较新、此设备较新或可能双向修改的情况。

## 为什么使用单旅行云端同步

- 此设备数据以 Trip / Day / ItineraryItem / TicketMeta / TicketBlob 的完整旅行图为单位。
- copy 模式票据包含 Blob 文件，不适合逐字段实时同步。
- 恢复时使用账号数据里的 Trip ID；此设备已有同 ID 旅行时，在用户确认后用账号数据更新该旅行图。
- 同步失败不会改变此设备 IndexedDB 数据。
- 自动云端同步不会做字段级合并。
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
- 恢复需要用户确认；确认后用账号数据覆盖此设备旅行，不会自动合并此设备修改。
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
- 不会合并多设备冲突。
- 此设备版本较新时会同步此设备版本并覆盖同一个云端同步记录。
- 可能双向修改时会提示用户选择同步方向。
- 删除本地旅行不会自动删除云端同步；云端删除仍需要用户手动确认。
- 同步失败不会阻止本地编辑，只会保留待同步状态并显示“云端同步失败，可稍后重试”。
- 离开页面时会尝试立即 flush 待同步任务，并在仍有待同步/同步中任务时触发浏览器原生离开提示；浏览器关闭瞬间的网络请求不保证一定完成，下次打开会继续补偿。
- zip 归档是可选的离线归档能力，适合用户主动留存文件。

## 长期同步协议路线

当前短期实现仍是单旅行账号同步：同一 `trip.id` 对应一个云端同步记录，内部继续使用 `snapshot.json`、`backupId`、`snapshot_path` 等兼容命名。用户界面按“账号数据 / 云端同步”呈现，内部命名不代表产品心智仍是备份工具。

如果后续要升级成更成熟的多设备同步，需要分阶段演进：

- 分对象同步：将 Trip / Day / ItineraryItem / TicketMeta 拆成对象级记录，保留对象 `updatedAt`、删除 tombstone、设备 ID 和操作 ID。
- 票据 Blob 独立同步：为 copy 票据引入云端 blob id、blob 同步状态和本机缓存状态；云端 blob 是长期来源，本机 blob 是可清理离线缓存。
- 增量同步队列：从整份旅行覆盖逐步迁移到对象级增量上传/下载，并保留可观测但不打扰用户的队列状态。
- 冲突合并：先做字段级安全合并和人工确认，再考虑多设备实时协作；票据文件、删除操作和时间字段必须有单独策略。
- 迁移兼容：旧版 `snapshot.json` 云端记录继续可恢复；任何 schema / RLS / Storage 改动必须有迁移与回滚方案。

本阶段不实现上述协议升级，也不提供清理旅行或票据离线缓存的按钮；没有独立 blob 同步状态前，不能承诺清理后一定可单票据恢复。

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

不是。它是单旅行账号同步：写入先落到此设备离线缓存，再通过自动同步队列更新同一个云端同步记录；它不会实时协作，也不会自动合并多设备字段级修改。

### reference / external 票据会上传文件吗？

不会。reference 只保存位置说明，external 只保存外部链接。

### copy 票据缺少本地 Blob 会怎样？

上传仍会继续，内部 `snapshot.json` 会保留票据元数据并返回 warning。恢复时会创建票据元数据，但不会生成 TicketBlob；后续预览时会显示离线缓存不可用，并提示重新同步账号数据或重新上传票据。
