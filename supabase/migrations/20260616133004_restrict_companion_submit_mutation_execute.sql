-- Restrict companion mutation submission to signed-in users.

revoke execute on function public.companion_submit_mutation(uuid, text, jsonb) from public;
revoke execute on function public.companion_submit_mutation(uuid, text, jsonb) from anon;
grant execute on function public.companion_submit_mutation(uuid, text, jsonb) to authenticated;
