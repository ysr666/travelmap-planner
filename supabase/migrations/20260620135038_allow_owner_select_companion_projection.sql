-- Allow a newly inserted owner projection to satisfy INSERT ... RETURNING.
-- Member reads continue to use the redacted private permission helper.

drop policy if exists "select shared trips by owner or member"
  on public.companion_shared_trips;

create policy "select shared trips by owner or member"
on public.companion_shared_trips
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or tripmap_private.companion_current_permission(id) is not null
);
