-- Extend owner-only account sync for Trip Ledger records and v2 snapshots.

alter table public.cloud_sync_objects
  drop constraint if exists cloud_sync_objects_object_type_check;

alter table public.cloud_sync_objects
  add constraint cloud_sync_objects_object_type_check
  check (object_type in (
    'trip',
    'day',
    'item',
    'ticket_meta',
    'ledger_settings',
    'ledger_participant',
    'ledger_budget',
    'ledger_expense'
  ));

alter table public.cloud_trip_backups
  drop constraint if exists cloud_trip_backups_schema_version_check;

alter table public.cloud_trip_backups
  add constraint cloud_trip_backups_schema_version_check
  check (schema_version in (1, 2));
