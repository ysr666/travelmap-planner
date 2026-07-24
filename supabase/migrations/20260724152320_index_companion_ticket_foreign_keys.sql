-- Keep companion ticket grant/event cleanup and user deletion paths indexed.

create index if not exists companion_ticket_file_grants_owner_id_idx
  on public.companion_ticket_file_grants (owner_id);

create index if not exists companion_ticket_file_events_owner_id_idx
  on public.companion_ticket_file_events (owner_id);

create index if not exists companion_ticket_file_events_actor_user_id_idx
  on public.companion_ticket_file_events (actor_user_id);
