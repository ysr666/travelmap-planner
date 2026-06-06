-- Remove legacy policy names that are equivalent to the current account sync
-- policies. Keeping one policy per command makes staging smoke output easier to
-- audit and avoids implying two separate sync paths.

drop policy if exists "cloud backups select own" on public.cloud_trip_backups;
drop policy if exists "cloud backups insert own" on public.cloud_trip_backups;
drop policy if exists "cloud backups update own" on public.cloud_trip_backups;
drop policy if exists "cloud backups delete own" on public.cloud_trip_backups;

drop policy if exists "trip backups read own objects" on storage.objects;
drop policy if exists "trip backups insert own objects" on storage.objects;
drop policy if exists "trip backups update own objects" on storage.objects;
drop policy if exists "trip backups delete own objects" on storage.objects;
