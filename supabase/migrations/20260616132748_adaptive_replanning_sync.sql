-- Adaptive replanning sync and companion mutation support.

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
    'replan_record'
  ));

alter table public.companion_shared_mutations
  drop constraint if exists companion_shared_mutations_mutation_type_check;

alter table public.companion_shared_mutations
  add constraint companion_shared_mutations_mutation_type_check
  check (mutation_type in (
    'update_item',
    'create_item',
    'delete_item',
    'reorder_day_items',
    'update_item_execution_state',
    'report_disruption',
    'request_replan_undo'
  ));

create or replace function public.companion_submit_mutation(
  target_shared_trip_id uuid,
  target_mutation_type text,
  mutation_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_permission text;
  mutation_id uuid;
  required_rank integer;
begin
  if target_mutation_type not in (
    'update_item',
    'create_item',
    'delete_item',
    'reorder_day_items',
    'update_item_execution_state',
    'report_disruption',
    'request_replan_undo'
  ) then
    raise exception 'invalid_mutation_type';
  end if;

  current_permission := public.companion_current_permission(target_shared_trip_id);
  required_rank := case
    when target_mutation_type = 'report_disruption' then 2
    else 3
  end;

  if public.companion_permission_rank(current_permission) < required_rank then
    raise exception 'permission_denied';
  end if;

  insert into public.companion_shared_mutations (
    shared_trip_id,
    user_id,
    mutation_type,
    payload
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    target_mutation_type,
    mutation_payload
  )
  returning id into mutation_id;

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    activity_type,
    body
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    'submitted_change',
    case
      when target_mutation_type = 'report_disruption' then '报告了突发情况'
      when target_mutation_type = 'request_replan_undo' then '请求撤销一次重排'
      else '提交了协作修改'
    end
  );

  return mutation_id;
end;
$$;

grant execute on function public.companion_submit_mutation(uuid, text, jsonb) to authenticated;
