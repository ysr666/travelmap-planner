-- Extend owner-only object sync for redacted intelligence history and suggestion state.

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
    'ledger_expense',
    'replan_event',
    'replan_record',
    'trip_intelligence_applied_change',
    'trip_intelligence_suggestion_state'
  ));
