create table if not exists public.travel_inbox_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('gmail', 'imap')),
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'reauth_required', 'error')),
  mailbox_folder text not null default 'INBOX',
  gmail_label_id text,
  auto_ai_enabled boolean not null default true,
  sync_cursor jsonb not null default '{}'::jsonb,
  backfill_days integer not null default 0 check (backfill_days in (0, 7, 30)),
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_inbox_connectors_user_idx
  on public.travel_inbox_connectors (user_id, updated_at desc);

create table if not exists public.travel_inbox_connector_secrets (
  connector_id uuid primary key references public.travel_inbox_connectors(id) on delete cascade,
  encrypted_secret text not null,
  encryption_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.travel_inbox_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id uuid references public.travel_inbox_connectors(id) on delete set null,
  connector_kind text not null check (connector_kind in ('gmail', 'imap')),
  provider_message_id text not null,
  dedupe_fingerprint text not null,
  status text not null default 'queued' check (status in ('queued', 'extracting', 'classifying', 'needs_assignment', 'building_preview', 'preview_ready', 'error')),
  source_kind text not null default 'email',
  label text not null,
  file_name text,
  mime_type text not null default 'message/rfc822',
  size bigint not null default 0 check (size >= 0 and size <= 20971520),
  storage_path text not null,
  target_trip_id text,
  classification jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  claimed_by text,
  claim_expires_at timestamptz,
  received_at timestamptz not null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_fingerprint)
);

create index if not exists travel_inbox_sources_user_status_idx
  on public.travel_inbox_sources (user_id, status, received_at desc);

create table if not exists public.travel_inbox_source_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_fingerprint text not null,
  connector_kind text not null,
  outcome text not null check (outcome in ('applied', 'discarded', 'expired', 'duplicate')),
  result_summary jsonb,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  primary key (user_id, dedupe_fingerprint)
);

alter table public.travel_inbox_connectors enable row level security;
alter table public.travel_inbox_connector_secrets enable row level security;
alter table public.travel_inbox_sources enable row level security;
alter table public.travel_inbox_source_tombstones enable row level security;

create policy "select own inbox connectors" on public.travel_inbox_connectors for select using ((select auth.uid()) = user_id);
create policy "update own inbox connectors" on public.travel_inbox_connectors for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own inbox connectors" on public.travel_inbox_connectors for delete using ((select auth.uid()) = user_id);
create policy "select own inbox sources" on public.travel_inbox_sources for select using ((select auth.uid()) = user_id);
create policy "update own inbox sources" on public.travel_inbox_sources for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own inbox sources" on public.travel_inbox_sources for delete using ((select auth.uid()) = user_id);
create policy "select own inbox source tombstones" on public.travel_inbox_source_tombstones for select using ((select auth.uid()) = user_id);
create policy "insert own inbox source tombstones" on public.travel_inbox_source_tombstones for insert with check ((select auth.uid()) = user_id);
create policy "update own inbox source tombstones" on public.travel_inbox_source_tombstones for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('travel-inbox-sources', 'travel-inbox-sources', false)
on conflict (id) do update set public = false;

create policy "read own travel inbox source objects" on storage.objects for select to authenticated
using (bucket_id = 'travel-inbox-sources' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "delete own travel inbox source objects" on storage.objects for delete to authenticated
using (bucket_id = 'travel-inbox-sources' and (storage.foldername(name))[1] = (auth.uid())::text);

create or replace function public.claim_travel_inbox_source(source_id uuid, claimant text, lease_seconds integer default 300)
returns public.travel_inbox_sources
language plpgsql
security definer
set search_path = public
as $$
declare claimed public.travel_inbox_sources;
begin
  update public.travel_inbox_sources
  set claimed_by = claimant,
      claim_expires_at = now() + make_interval(secs => greatest(30, least(lease_seconds, 900))),
      updated_at = now()
  where id = source_id
    and user_id = auth.uid()
    and status in ('queued', 'extracting', 'classifying', 'needs_assignment', 'building_preview', 'error')
    and (claim_expires_at is null or claim_expires_at < now() or claimed_by = claimant)
  returning * into claimed;
  return claimed;
end;
$$;

revoke all on function public.claim_travel_inbox_source(uuid, text, integer) from public;
grant execute on function public.claim_travel_inbox_source(uuid, text, integer) to authenticated;

create or replace function public.release_travel_inbox_source_claim(source_id uuid, claimant text)
returns void language sql security definer set search_path = public as $$
  update public.travel_inbox_sources
  set claimed_by = null, claim_expires_at = null, updated_at = now()
  where id = source_id and user_id = auth.uid() and claimed_by = claimant;
$$;

revoke all on function public.release_travel_inbox_source_claim(uuid, text) from public;
grant execute on function public.release_travel_inbox_source_claim(uuid, text) to authenticated;
