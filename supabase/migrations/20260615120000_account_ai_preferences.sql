create table if not exists public.account_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_expense_ai_enabled boolean not null default false,
  consented_at timestamptz,
  privacy_version integer not null default 1 check (privacy_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists account_ai_preferences_set_updated_at on public.account_ai_preferences;
create trigger account_ai_preferences_set_updated_at
before update on public.account_ai_preferences
for each row execute function public.set_updated_at();

alter table public.account_ai_preferences enable row level security;

drop policy if exists "select own account ai preferences" on public.account_ai_preferences;
create policy "select own account ai preferences"
on public.account_ai_preferences for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "insert own account ai preferences" on public.account_ai_preferences;
create policy "insert own account ai preferences"
on public.account_ai_preferences for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "update own account ai preferences" on public.account_ai_preferences;
create policy "update own account ai preferences"
on public.account_ai_preferences for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "delete own account ai preferences" on public.account_ai_preferences;
create policy "delete own account ai preferences"
on public.account_ai_preferences for delete
to authenticated
using (auth.uid() = user_id);
