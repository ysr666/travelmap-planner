-- Additive account-cloud V2 contract.
--
-- This migration deliberately leaves cloud_sync_objects untouched. Compatible
-- legacy rows are copied into the new revisioned envelope, while the web client
-- keeps using the legacy path until the cloud-first cutover is separately
-- deployed and verified.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists tripmap_private authorization postgres;
revoke all on schema tripmap_private from public, anon, authenticated;
grant usage on schema tripmap_private to authenticated, service_role;

create table if not exists public.tripmap_account_objects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null
    check (
      pg_catalog.length(trip_id) between 1 and 160
      and trip_id !~ '[[:cntrl:]]'
    ),
  object_type text not null
    check (object_type in (
      'trip',
      'day',
      'item',
      'ticket_meta',
      'document_index',
      'document_trip_link',
      'transport_booking',
      'transport_segment',
      'lodging',
      'insurance',
      'media_asset',
      'realtime_fact',
      'ledger_settings',
      'ledger_participant',
      'ledger_budget',
      'ledger_expense',
      'trip_intelligence_applied_change',
      'trip_intelligence_suggestion_state',
      'shared_task',
      'ai_job',
      'replan_event',
      'replan_record'
    )),
  object_id text not null
    check (
      pg_catalog.length(object_id) between 1 and 160
      and object_id !~ '[[:cntrl:]]'
    ),
  payload jsonb,
  schema_version smallint not null
    check (schema_version between 1 and 32),
  revision bigint not null
    check (revision >= 1),
  mutation_id text not null
    check (
      pg_catalog.length(mutation_id) between 1 and 160
      and mutation_id !~ '[[:cntrl:]]'
    ),
  actor_id uuid not null,
  device_id text not null
    check (
      pg_catalog.length(device_id) between 1 and 128
      and device_id !~ '[[:cntrl:]]'
    ),
  tombstone boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (owner_id, object_type, object_id),
  check (
    (tombstone and payload is null and deleted_at is not null)
    or (
      not tombstone
      and payload is not null
      and pg_catalog.jsonb_typeof(payload) = 'object'
      and deleted_at is null
      and pg_catalog.octet_length(payload::text) <= 2097152
    )
  )
);

create index if not exists tripmap_account_objects_owner_trip_revision_idx
  on public.tripmap_account_objects (owner_id, trip_id, revision desc);

create index if not exists tripmap_account_objects_owner_trip_updated_idx
  on public.tripmap_account_objects (owner_id, trip_id, updated_at desc);

create index if not exists tripmap_account_objects_tombstone_retention_idx
  on public.tripmap_account_objects (deleted_at)
  where tombstone;

alter table public.tripmap_account_objects replica identity full;
alter table public.tripmap_account_objects enable row level security;
alter table public.tripmap_account_objects force row level security;

drop policy if exists "select own account objects" on public.tripmap_account_objects;
create policy "select own account objects"
on public.tripmap_account_objects
for select
to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.tripmap_account_objects from public, anon, authenticated;
grant select on table public.tripmap_account_objects to authenticated;
grant select, insert, update, delete on table public.tripmap_account_objects to service_role;

create table if not exists tripmap_private.account_mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null
    check (
      pg_catalog.length(mutation_id) between 1 and 160
      and mutation_id !~ '[[:cntrl:]]'
    ),
  request_hash text not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  trip_id text not null,
  object_type text not null,
  object_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  expected_revision bigint not null check (expected_revision >= 0),
  applied_revision bigint not null check (applied_revision >= 1),
  schema_version smallint not null check (schema_version between 1 and 32),
  actor_id uuid not null,
  device_id text not null,
  applied_at timestamptz not null default pg_catalog.now(),
  primary key (owner_id, mutation_id)
);

create index if not exists account_mutation_receipts_owner_applied_idx
  on tripmap_private.account_mutation_receipts (owner_id, applied_at desc);

create index if not exists account_mutation_receipts_object_idx
  on tripmap_private.account_mutation_receipts (
    owner_id,
    object_type,
    object_id,
    applied_revision desc
  );

alter table tripmap_private.account_mutation_receipts enable row level security;
alter table tripmap_private.account_mutation_receipts force row level security;
revoke all on table tripmap_private.account_mutation_receipts from public, anon, authenticated;
grant select, insert, update, delete on table tripmap_private.account_mutation_receipts to service_role;

create or replace function tripmap_private.account_payload_has_forbidden_key(
  target_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  payload_entry record;
  normalized_key text;
begin
  if pg_catalog.jsonb_typeof(target_payload) = 'object' then
    for payload_entry in
      select key, value from pg_catalog.jsonb_each(target_payload)
    loop
      normalized_key := pg_catalog.lower(
        pg_catalog.regexp_replace(payload_entry.key, '[^a-zA-Z0-9]', '', 'g')
      );
      if normalized_key in (
        'password',
        'passcode',
        'accesstoken',
        'refreshtoken',
        'authorization',
        'bearer',
        'secret',
        'providerkey',
        'apikey',
        'blob',
        'fileblob',
        'rawproviderpayload',
        'providerpayload',
        'ocrtext',
        'documentbody',
        'passportnumber',
        'visanumber'
      ) then
        return true;
      end if;
      if pg_catalog.jsonb_typeof(payload_entry.value) in ('object', 'array')
         and tripmap_private.account_payload_has_forbidden_key(payload_entry.value) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(target_payload) = 'array' then
    for payload_entry in
      select value from pg_catalog.jsonb_array_elements(target_payload)
    loop
      if pg_catalog.jsonb_typeof(payload_entry.value) in ('object', 'array')
         and tripmap_private.account_payload_has_forbidden_key(payload_entry.value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function tripmap_private.account_ticket_meta_payload_is_valid(
  target_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  visibility jsonb;
begin
  if pg_catalog.jsonb_typeof(target_payload) <> 'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(target_payload) as ticket_field(field_name)
       where ticket_field.field_name not in (
         'bookingId',
         'createdAt',
         'fileType',
         'id',
         'itemId',
         'mimeType',
         'scope',
         'sharedVisibility',
         'size',
         'storageMode',
         'ticketCategory',
         'title',
         'tripId',
         'updatedAt'
       )
     )
     or pg_catalog.jsonb_typeof(target_payload -> 'createdAt') is distinct from 'number'
     or target_payload ->> 'createdAt' !~ '^[0-9]{1,16}$'
     or pg_catalog.jsonb_typeof(target_payload -> 'updatedAt') is distinct from 'number'
     or target_payload ->> 'updatedAt' !~ '^[0-9]{1,16}$'
     or pg_catalog.jsonb_typeof(target_payload -> 'size') is distinct from 'number'
     or target_payload ->> 'size' !~ '^[0-9]{1,16}$'
     or pg_catalog.jsonb_typeof(target_payload -> 'fileType') is distinct from 'string'
     or target_payload ->> 'fileType' not in ('image', 'pdf', 'other')
     or pg_catalog.jsonb_typeof(target_payload -> 'mimeType') is distinct from 'string'
     or pg_catalog.length(target_payload ->> 'mimeType') not between 1 and 255
     or target_payload ->> 'mimeType' ~ '[[:cntrl:]]'
     or (
       target_payload ? 'title'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'title') <> 'string'
         or pg_catalog.length(target_payload ->> 'title') not between 1 and 500
         or target_payload ->> 'title' ~ '[[:cntrl:]]'
       )
     )
     or (
       target_payload ? 'bookingId'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'bookingId') <> 'string'
         or pg_catalog.length(target_payload ->> 'bookingId') not between 1 and 160
         or target_payload ->> 'bookingId' ~ '[[:cntrl:]]'
       )
     )
     or (
       target_payload ? 'itemId'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'itemId') <> 'string'
         or target_payload ->> 'itemId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       )
     )
     or (
       target_payload ? 'scope'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'scope') <> 'string'
         or target_payload ->> 'scope' not in ('trip', 'item', 'unassigned')
       )
     )
     or coalesce(target_payload ->> 'scope' = 'item', false)
       is distinct from (target_payload ? 'itemId')
     or (
       target_payload ? 'storageMode'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'storageMode') <> 'string'
         or target_payload ->> 'storageMode' not in ('copy', 'reference', 'external')
       )
     )
     or (
       target_payload ? 'ticketCategory'
       and (
         pg_catalog.jsonb_typeof(target_payload -> 'ticketCategory') <> 'string'
         or target_payload ->> 'ticketCategory' not in (
           'admission_ticket',
           'train_ticket',
           'flight_ticket',
           'hotel_booking',
           'restaurant_reservation',
           'transport_booking',
           'other'
         )
       )
     ) then
    return false;
  end if;

  if (target_payload ->> 'createdAt')::numeric > 9007199254740991
     or (target_payload ->> 'updatedAt')::numeric > 9007199254740991
     or (target_payload ->> 'size')::numeric > 9007199254740991
     or (target_payload ->> 'updatedAt')::numeric < (target_payload ->> 'createdAt')::numeric then
    return false;
  end if;

  if target_payload ? 'sharedVisibility' then
    visibility := target_payload -> 'sharedVisibility';
    if pg_catalog.jsonb_typeof(visibility) <> 'object'
       or pg_catalog.jsonb_typeof(visibility -> 'mode') is distinct from 'string'
       or visibility ->> 'mode' not in ('all', 'assigned')
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(visibility) as visibility_field(field_name)
         where visibility_field.field_name not in ('memberIds', 'mode')
       ) then
      return false;
    end if;
    if visibility ->> 'mode' = 'all' then
      if visibility ? 'memberIds' then return false; end if;
    elsif pg_catalog.jsonb_typeof(visibility -> 'memberIds') is distinct from 'array'
       or pg_catalog.jsonb_array_length(visibility -> 'memberIds') > 64
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(visibility -> 'memberIds') as member(value)
         where pg_catalog.jsonb_typeof(member.value) <> 'string'
           or member.value #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       )
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_array_elements(visibility -> 'memberIds') as member(value)
       ) <> (
         select pg_catalog.count(distinct member.value #>> '{}')
         from pg_catalog.jsonb_array_elements(visibility -> 'memberIds') as member(value)
       ) then
      return false;
    end if;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function tripmap_private.account_redact_ticket_meta_payload(
  target_payload jsonb
)
returns jsonb
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'bookingId', target_payload -> 'bookingId',
      'createdAt', target_payload -> 'createdAt',
      'fileType', target_payload -> 'fileType',
      'id', target_payload -> 'id',
      'itemId', target_payload -> 'itemId',
      'mimeType', target_payload -> 'mimeType',
      'scope', coalesce(
        target_payload -> 'scope',
        pg_catalog.to_jsonb(
          case
            when target_payload ->> 'itemId' is not null then 'item'
            else 'unassigned'
          end
        )
      ),
      'sharedVisibility', target_payload -> 'sharedVisibility',
      'size', target_payload -> 'size',
      'storageMode', target_payload -> 'storageMode',
      'ticketCategory', target_payload -> 'ticketCategory',
      'title', target_payload -> 'title',
      'tripId', target_payload -> 'tripId',
      'updatedAt', target_payload -> 'updatedAt'
    )
  );
$$;

create or replace function tripmap_private.account_ledger_timestamp_is_valid(
  target_value text
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.length(target_value) not between 1 and 100
     or target_value ~ '[[:cntrl:]]'
     or target_value !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]{1,3})?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?)?$' then
    return false;
  end if;

  perform pg_catalog.make_date(
    pg_catalog.substr(target_value, 1, 4)::integer,
    pg_catalog.substr(target_value, 6, 2)::integer,
    pg_catalog.substr(target_value, 9, 2)::integer
  );
  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function tripmap_private.account_ledger_payload_is_valid(
  target_object_type text,
  target_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  allowed_fields text[];
  source_value jsonb;
begin
  if target_object_type not in (
    'ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense'
  ) or pg_catalog.jsonb_typeof(target_payload) <> 'object'
     or pg_catalog.jsonb_typeof(target_payload -> 'id') is distinct from 'string'
     or pg_catalog.jsonb_typeof(target_payload -> 'tripId') is distinct from 'string'
     or target_payload ->> 'id' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_payload ->> 'tripId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or pg_catalog.jsonb_typeof(target_payload -> 'createdAt') is distinct from 'number'
     or target_payload ->> 'createdAt' !~ '^[0-9]{1,16}$'
     or pg_catalog.jsonb_typeof(target_payload -> 'updatedAt') is distinct from 'number'
     or target_payload ->> 'updatedAt' !~ '^[0-9]{1,16}$'
     or (target_payload ->> 'createdAt')::numeric > 9007199254740991
     or (target_payload ->> 'updatedAt')::numeric > 9007199254740991
     or (target_payload ->> 'updatedAt')::numeric < (target_payload ->> 'createdAt')::numeric then
    return false;
  end if;

  if target_object_type = 'ledger_settings' then
    allowed_fields := array['id', 'tripId', 'homeCurrency', 'tripCurrency', 'settlementCurrency', 'createdAt', 'updatedAt'];
    if pg_catalog.jsonb_typeof(target_payload -> 'homeCurrency') is distinct from 'string'
       or target_payload ->> 'homeCurrency' !~ '^[A-Z]{3}$'
       or pg_catalog.jsonb_typeof(target_payload -> 'tripCurrency') is distinct from 'string'
       or target_payload ->> 'tripCurrency' !~ '^[A-Z]{3}$'
       or pg_catalog.jsonb_typeof(target_payload -> 'settlementCurrency') is distinct from 'string'
       or target_payload ->> 'settlementCurrency' !~ '^[A-Z]{3}$' then return false; end if;
  elsif target_object_type = 'ledger_participant' then
    allowed_fields := array['id', 'tripId', 'displayName', 'isSelf', 'source', 'sourceId', 'createdAt', 'updatedAt'];
    if pg_catalog.jsonb_typeof(target_payload -> 'displayName') is distinct from 'string'
       or pg_catalog.length(target_payload ->> 'displayName') not between 1 and 160
       or target_payload ->> 'displayName' ~ '[[:cntrl:]]'
       or (target_payload ? 'isSelf' and pg_catalog.jsonb_typeof(target_payload -> 'isSelf') <> 'boolean')
       or (target_payload ? 'source' and (
         pg_catalog.jsonb_typeof(target_payload -> 'source') <> 'string'
         or target_payload ->> 'source' not in ('manual', 'shared_trip', 'traveler_profile')
       ))
       or (target_payload ? 'sourceId' and (
         pg_catalog.jsonb_typeof(target_payload -> 'sourceId') <> 'string'
         or target_payload ->> 'sourceId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       ))
       or (target_payload ->> 'source' = 'manual' and target_payload ? 'sourceId') then return false; end if;
  elsif target_object_type = 'ledger_budget' then
    allowed_fields := array['id', 'tripId', 'scope', 'amountMinor', 'currency', 'category', 'date', 'createdAt', 'updatedAt'];
    if pg_catalog.jsonb_typeof(target_payload -> 'scope') is distinct from 'string'
       or target_payload ->> 'scope' not in ('trip', 'category', 'date')
       or pg_catalog.jsonb_typeof(target_payload -> 'amountMinor') is distinct from 'number'
       or target_payload ->> 'amountMinor' !~ '^[0-9]{1,16}$'
       or (target_payload ->> 'amountMinor')::numeric > 9007199254740991
       or pg_catalog.jsonb_typeof(target_payload -> 'currency') is distinct from 'string'
       or target_payload ->> 'currency' !~ '^[A-Z]{3}$'
       or (target_payload ? 'category' and (
         pg_catalog.jsonb_typeof(target_payload -> 'category') <> 'string'
         or target_payload ->> 'category' not in ('lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other')
       ))
       or (target_payload ? 'date' and (
         pg_catalog.jsonb_typeof(target_payload -> 'date') <> 'string'
         or target_payload ->> 'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       ))
       or (target_payload ->> 'scope' = 'trip' and (target_payload ? 'category' or target_payload ? 'date'))
       or (target_payload ->> 'scope' = 'category' and (not target_payload ? 'category' or target_payload ? 'date'))
       or (target_payload ->> 'scope' = 'date' and (not target_payload ? 'date' or target_payload ? 'category')) then return false; end if;
  else
    allowed_fields := array[
      'id', 'tripId', 'title', 'date', 'category', 'status', 'amountMinor', 'currency',
      'payerParticipantId', 'splitMode', 'splitShares', 'source', 'sourceLinks', 'lineItems',
      'merchant', 'city', 'orderNumber', 'itemIds', 'bookedAt', 'paidAt', 'serviceStartAt',
      'serviceEndAt', 'cancelledAt', 'refundedAt', 'paymentStatus', 'orderStatus', 'reviewStatus',
      'recognitionConfidence', 'autoConfirmReason', 'originalExpenseId', 'exchangeRate',
      'duplicateAcknowledged', 'notes', 'createdAt', 'updatedAt'
    ];
    if pg_catalog.jsonb_typeof(target_payload -> 'title') is distinct from 'string'
       or pg_catalog.length(target_payload ->> 'title') not between 1 and 500
       or target_payload ->> 'title' ~ '[[:cntrl:]]'
       or pg_catalog.jsonb_typeof(target_payload -> 'date') is distinct from 'string'
       or target_payload ->> 'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or pg_catalog.jsonb_typeof(target_payload -> 'category') is distinct from 'string'
       or target_payload ->> 'category' not in ('lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other')
       or pg_catalog.jsonb_typeof(target_payload -> 'status') is distinct from 'string'
       or target_payload ->> 'status' not in ('draft', 'confirmed', 'void')
       or pg_catalog.jsonb_typeof(target_payload -> 'splitMode') is distinct from 'string'
       or target_payload ->> 'splitMode' not in ('equal', 'exclude', 'weights')
       or pg_catalog.jsonb_typeof(target_payload -> 'splitShares') is distinct from 'array'
       or pg_catalog.jsonb_array_length(target_payload -> 'splitShares') > 128
       or pg_catalog.jsonb_typeof(target_payload -> 'source') is distinct from 'object'
       or (target_payload ? 'amountMinor' and not target_payload ? 'currency')
       or (target_payload ? 'amountMinor' and (
         pg_catalog.jsonb_typeof(target_payload -> 'amountMinor') <> 'number'
         or target_payload ->> 'amountMinor' !~ '^-?[0-9]{1,16}$'
         or pg_catalog.abs((target_payload ->> 'amountMinor')::numeric) > 9007199254740991
       ))
       or (target_payload ? 'currency' and (
         pg_catalog.jsonb_typeof(target_payload -> 'currency') <> 'string'
         or target_payload ->> 'currency' !~ '^[A-Z]{3}$'
       ))
       or (target_payload ? 'payerParticipantId' and (
         pg_catalog.jsonb_typeof(target_payload -> 'payerParticipantId') <> 'string'
         or target_payload ->> 'payerParticipantId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       ))
       or (target_payload ? 'originalExpenseId' and (
         pg_catalog.jsonb_typeof(target_payload -> 'originalExpenseId') <> 'string'
         or target_payload ->> 'originalExpenseId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
         or target_payload ->> 'originalExpenseId' = target_payload ->> 'id'
       ))
       or (target_payload ? 'paymentStatus' and (
         pg_catalog.jsonb_typeof(target_payload -> 'paymentStatus') is distinct from 'string'
         or target_payload ->> 'paymentStatus' not in ('unknown', 'unpaid', 'paid', 'partially_refunded', 'refunded')
       ))
       or (target_payload ? 'orderStatus' and (
         pg_catalog.jsonb_typeof(target_payload -> 'orderStatus') is distinct from 'string'
         or target_payload ->> 'orderStatus' not in ('active', 'cancelled')
       ))
       or (target_payload ? 'reviewStatus' and (
         pg_catalog.jsonb_typeof(target_payload -> 'reviewStatus') is distinct from 'string'
         or target_payload ->> 'reviewStatus' not in ('unreviewed', 'auto_confirmed', 'reviewed', 'needs_review')
       ))
       or (target_payload ? 'duplicateAcknowledged' and pg_catalog.jsonb_typeof(target_payload -> 'duplicateAcknowledged') <> 'boolean')
       or (target_payload ? 'recognitionConfidence' and (
         pg_catalog.jsonb_typeof(target_payload -> 'recognitionConfidence') <> 'number'
         or (target_payload ->> 'recognitionConfidence')::numeric not between 0 and 1
       ))
       or (target_payload ? 'notes' and (
         pg_catalog.jsonb_typeof(target_payload -> 'notes') <> 'string'
         or pg_catalog.length(target_payload ->> 'notes') > 4000
         or pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
           target_payload ->> 'notes', E'\t', ''
         ), E'\n', ''), E'\r', '') ~ '[[:cntrl:]]'
       ))
       or exists (
         select 1
         from pg_catalog.unnest(array[
           'merchant', 'city', 'orderNumber', 'autoConfirmReason'
         ]) as bounded_field(field_name)
         where target_payload ? bounded_field.field_name
           and (
             pg_catalog.jsonb_typeof(target_payload -> bounded_field.field_name) <> 'string'
             or pg_catalog.length(target_payload ->> bounded_field.field_name) not between 1 and 500
             or target_payload ->> bounded_field.field_name ~ '[[:cntrl:]]'
           )
       )
       or exists (
         select 1
         from pg_catalog.unnest(array[
           'bookedAt', 'paidAt', 'serviceStartAt', 'serviceEndAt', 'cancelledAt', 'refundedAt'
         ]) as timestamp_field(field_name)
         where target_payload ? timestamp_field.field_name
           and (
             pg_catalog.jsonb_typeof(target_payload -> timestamp_field.field_name) <> 'string'
             or not tripmap_private.account_ledger_timestamp_is_valid(
               target_payload ->> timestamp_field.field_name
             )
           )
       )
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(target_payload -> 'splitShares') as share(value)
         where pg_catalog.jsonb_typeof(share.value) <> 'object'
           or share.value ->> 'participantId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
           or pg_catalog.jsonb_typeof(share.value -> 'participantId') is distinct from 'string'
           or pg_catalog.jsonb_typeof(share.value -> 'weight') is distinct from 'number'
           or (share.value ->> 'weight')::numeric <= 0
           or (share.value ->> 'weight')::numeric > 9007199254740991
           or exists (select 1 from pg_catalog.jsonb_object_keys(share.value) as field(name) where field.name not in ('participantId', 'weight'))
       )
       or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(target_payload -> 'splitShares')) <>
          (select pg_catalog.count(distinct share.value ->> 'participantId') from pg_catalog.jsonb_array_elements(target_payload -> 'splitShares') as share(value))
       or (target_payload ? 'itemIds' and (
         pg_catalog.jsonb_typeof(target_payload -> 'itemIds') <> 'array'
         or pg_catalog.jsonb_array_length(target_payload -> 'itemIds') > 256
         or exists (select 1 from pg_catalog.jsonb_array_elements(target_payload -> 'itemIds') as item(value) where pg_catalog.jsonb_typeof(item.value) <> 'string' or item.value #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$')
         or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(target_payload -> 'itemIds')) <> (select pg_catalog.count(distinct item.value #>> '{}') from pg_catalog.jsonb_array_elements(target_payload -> 'itemIds') as item(value))
       ))
       or (target_payload ? 'sourceLinks' and (
         pg_catalog.jsonb_typeof(target_payload -> 'sourceLinks') <> 'array'
         or pg_catalog.jsonb_array_length(target_payload -> 'sourceLinks') > 128
         or exists (
           select 1 from pg_catalog.jsonb_array_elements(target_payload -> 'sourceLinks') as source_link(value)
           where pg_catalog.jsonb_typeof(source_link.value) <> 'object'
             or source_link.value ->> 'id' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
             or pg_catalog.jsonb_typeof(source_link.value -> 'id') is distinct from 'string'
             or pg_catalog.jsonb_typeof(source_link.value -> 'kind') is distinct from 'string'
             or source_link.value ->> 'kind' not in ('manual', 'ticket', 'inbox', 'transport_booking', 'itinerary_note')
             or pg_catalog.jsonb_typeof(source_link.value -> 'role') is distinct from 'string'
             or source_link.value ->> 'role' not in ('order_confirmation', 'payment_receipt', 'invoice', 'credit_card_notice', 'cancellation_notice', 'refund_notice', 'other')
             or (source_link.value ? 'sourceId' and (
               pg_catalog.jsonb_typeof(source_link.value -> 'sourceId') <> 'string'
               or source_link.value ->> 'sourceId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
             ))
             or (source_link.value ? 'available' and pg_catalog.jsonb_typeof(source_link.value -> 'available') <> 'boolean')
             or exists (select 1 from pg_catalog.jsonb_object_keys(source_link.value) as field(name) where field.name not in ('id', 'kind', 'sourceId', 'label', 'fingerprint', 'role', 'title', 'capturedAt', 'available'))
         )
         or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(target_payload -> 'sourceLinks')) <> (select pg_catalog.count(distinct source_link.value ->> 'id') from pg_catalog.jsonb_array_elements(target_payload -> 'sourceLinks') as source_link(value))
       ))
       or (target_payload ? 'lineItems' and (
         pg_catalog.jsonb_typeof(target_payload -> 'lineItems') <> 'array'
         or pg_catalog.jsonb_array_length(target_payload -> 'lineItems') > 256
         or exists (
           select 1 from pg_catalog.jsonb_array_elements(target_payload -> 'lineItems') as line_item(value)
           where pg_catalog.jsonb_typeof(line_item.value) <> 'object'
             or line_item.value ->> 'id' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
             or pg_catalog.jsonb_typeof(line_item.value -> 'id') is distinct from 'string'
             or pg_catalog.jsonb_typeof(line_item.value -> 'title') is distinct from 'string'
             or pg_catalog.length(line_item.value ->> 'title') not between 1 and 500
             or line_item.value ->> 'title' ~ '[[:cntrl:]]'
             or pg_catalog.jsonb_typeof(line_item.value -> 'kind') is distinct from 'string'
             or line_item.value ->> 'kind' not in ('base', 'tax', 'tip', 'discount', 'refund', 'other')
             or pg_catalog.jsonb_typeof(line_item.value -> 'category') is distinct from 'string'
             or line_item.value ->> 'category' not in ('lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other')
             or pg_catalog.jsonb_typeof(line_item.value -> 'amountMinor') is distinct from 'number'
             or line_item.value ->> 'amountMinor' !~ '^-?[0-9]{1,16}$'
             or pg_catalog.abs((line_item.value ->> 'amountMinor')::numeric) > 9007199254740991
             or pg_catalog.jsonb_typeof(line_item.value -> 'currency') is distinct from 'string'
             or line_item.value ->> 'currency' !~ '^[A-Z]{3}$'
             or exists (select 1 from pg_catalog.jsonb_object_keys(line_item.value) as field(name) where field.name not in ('id', 'title', 'kind', 'category', 'amountMinor', 'currency'))
         )
         or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(target_payload -> 'lineItems')) <> (select pg_catalog.count(distinct line_item.value ->> 'id') from pg_catalog.jsonb_array_elements(target_payload -> 'lineItems') as line_item(value))
       ))
       or (target_payload ? 'exchangeRate' and (
         pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate') <> 'object'
         or exists (select 1 from pg_catalog.jsonb_object_keys(target_payload -> 'exchangeRate') as field(name) where field.name not in ('requestedDate', 'effectiveDate', 'baseCurrency', 'tripCurrency', 'homeCurrency', 'rateToTrip', 'rateToHome', 'provider', 'sourceUrl', 'fetchedAt'))
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'requestedDate') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'requestedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'effectiveDate') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'baseCurrency') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'baseCurrency' !~ '^[A-Z]{3}$'
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'tripCurrency') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'tripCurrency' !~ '^[A-Z]{3}$'
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'homeCurrency') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'homeCurrency' !~ '^[A-Z]{3}$'
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'rateToTrip') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'rateToTrip' !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$'
         or (target_payload -> 'exchangeRate' ->> 'rateToTrip')::numeric <= 0
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'rateToHome') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'rateToHome' !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$'
         or (target_payload -> 'exchangeRate' ->> 'rateToHome')::numeric <= 0
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'provider') is distinct from 'string'
         or target_payload -> 'exchangeRate' ->> 'provider' not in ('frankfurter', 'manual')
         or pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'fetchedAt') is distinct from 'string'
         or not tripmap_private.account_ledger_timestamp_is_valid(
           target_payload -> 'exchangeRate' ->> 'fetchedAt'
         )
         or (target_payload -> 'exchangeRate' ? 'sourceUrl' and (
           pg_catalog.jsonb_typeof(target_payload -> 'exchangeRate' -> 'sourceUrl') is distinct from 'string'
           or pg_catalog.length(target_payload -> 'exchangeRate' ->> 'sourceUrl') not between 1 and 2048
           or target_payload -> 'exchangeRate' ->> 'sourceUrl' ~ '[[:cntrl:]]'
           or target_payload -> 'exchangeRate' ->> 'sourceUrl' !~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
         ))
       )) then return false; end if;

    source_value := target_payload -> 'source';
    if exists (select 1 from pg_catalog.jsonb_object_keys(source_value) as field(name) where field.name not in ('kind', 'sourceId', 'label', 'fingerprint'))
       or pg_catalog.jsonb_typeof(source_value -> 'kind') is distinct from 'string'
       or source_value ->> 'kind' not in ('manual', 'ticket', 'inbox', 'transport_booking', 'itinerary_note')
       or (source_value ? 'sourceId' and (
         pg_catalog.jsonb_typeof(source_value -> 'sourceId') <> 'string'
         or source_value ->> 'sourceId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       ))
       or (source_value ? 'label' and (
         pg_catalog.jsonb_typeof(source_value -> 'label') <> 'string'
         or pg_catalog.length(source_value ->> 'label') not between 1 and 500
         or source_value ->> 'label' ~ '[[:cntrl:]]'
       ))
       or (source_value ? 'fingerprint' and (
         pg_catalog.jsonb_typeof(source_value -> 'fingerprint') <> 'string'
         or pg_catalog.length(source_value ->> 'fingerprint') not between 1 and 500
         or source_value ->> 'fingerprint' ~ '[[:cntrl:]]'
       )) then return false; end if;

    if target_payload ? 'sourceLinks' and exists (
      select 1 from pg_catalog.jsonb_array_elements(target_payload -> 'sourceLinks') as source_link(value)
      where (source_link.value ? 'label' and (
          pg_catalog.jsonb_typeof(source_link.value -> 'label') is distinct from 'string'
          or pg_catalog.length(source_link.value ->> 'label') not between 1 and 500
          or source_link.value ->> 'label' ~ '[[:cntrl:]]'
        ))
        or (source_link.value ? 'fingerprint' and (
          pg_catalog.jsonb_typeof(source_link.value -> 'fingerprint') is distinct from 'string'
          or pg_catalog.length(source_link.value ->> 'fingerprint') not between 1 and 500
          or source_link.value ->> 'fingerprint' ~ '[[:cntrl:]]'
        ))
        or (source_link.value ? 'title' and (
          pg_catalog.jsonb_typeof(source_link.value -> 'title') is distinct from 'string'
          or pg_catalog.length(source_link.value ->> 'title') not between 1 and 500
          or source_link.value ->> 'title' ~ '[[:cntrl:]]'
        ))
        or (source_link.value ? 'capturedAt' and (
          pg_catalog.jsonb_typeof(source_link.value -> 'capturedAt') is distinct from 'string'
          or not tripmap_private.account_ledger_timestamp_is_valid(
            source_link.value ->> 'capturedAt'
          )
        ))
    ) then return false; end if;
  end if;

  return not exists (
    select 1 from pg_catalog.jsonb_object_keys(target_payload) as payload_field(field_name)
    where not (payload_field.field_name = any(allowed_fields))
  );
exception
  when others then
    return false;
end;
$$;

create or replace function tripmap_private.account_object_public_json(
  target_object public.tripmap_account_objects
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'tripId', target_object.trip_id,
    'objectType', target_object.object_type,
    'objectId', target_object.object_id,
    'payload', target_object.payload,
    'objectSchemaVersion', target_object.schema_version,
    'revision', target_object.revision,
    'mutationId', target_object.mutation_id,
    'actorId', target_object.actor_id,
    'deviceId', target_object.device_id,
    'tombstone', target_object.tombstone,
    'deletedAt', target_object.deleted_at,
    'createdAt', target_object.created_at,
    'updatedAt', target_object.updated_at
  );
$$;

-- Remove the superseded pre-account-context overload if an early Preview applied it.
drop function if exists public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
);
drop function if exists tripmap_private.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
);

create or replace function tripmap_private.account_apply_object_mutation_v1(
  target_schema_version integer,
  target_account_hash text,
  target_mutation_id text,
  target_trip_id text,
  target_object_type text,
  target_object_id text,
  target_operation text,
  target_expected_revision bigint,
  target_object_schema_version integer,
  target_device_id text,
  target_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_object public.tripmap_account_objects%rowtype;
  prior_receipt tripmap_private.account_mutation_receipts%rowtype;
  current_revision bigint;
  next_revision bigint;
  request_hash text;
  has_current_object boolean;
  structural_day_id text;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;

  if target_account_hash is null
     or target_account_hash !~ '^[a-f0-9]{32}$'
     or target_account_hash <> pg_catalog.left(
       pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(current_user_id::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       ),
       32
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'account_context_mismatch'
    );
  end if;

  if target_schema_version is null
     or target_schema_version <> 1
     or target_object_schema_version is null
     or target_object_schema_version not between 1 and 32
     or target_expected_revision is null
     or target_expected_revision < 0 then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'invalid_version_or_revision'
    );
  end if;

  if target_object_type is null or target_object_type not in (
    'trip',
    'day',
    'item',
    'ticket_meta',
    'document_index',
    'document_trip_link',
    'transport_booking',
    'transport_segment',
    'lodging',
    'insurance',
    'media_asset',
    'realtime_fact',
    'ledger_settings',
    'ledger_participant',
    'ledger_budget',
    'ledger_expense',
    'trip_intelligence_applied_change',
    'trip_intelligence_suggestion_state',
    'shared_task',
    'ai_job',
    'replan_event',
    'replan_record'
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'unknown_object_type'
    );
  end if;

  if target_object_type in ('media_asset', 'realtime_fact', 'ai_job') then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'server_managed_object'
    );
  end if;

  if target_operation is null
     or target_operation not in ('upsert', 'delete')
     or target_mutation_id is null
     or target_mutation_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_trip_id is null
     or target_trip_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_object_id is null
     or target_object_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_device_id is null
     or target_device_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'invalid_identifier_or_operation'
    );
  end if;

  if target_operation = 'upsert' and (
    target_payload is null
    or pg_catalog.jsonb_typeof(target_payload) <> 'object'
    or pg_catalog.octet_length(target_payload::text) > 524288
    or target_payload ->> 'id' is distinct from target_object_id
    or (
      target_object_type = 'trip'
      and target_trip_id is distinct from target_object_id
    )
    or (
      target_object_type <> 'trip'
      and target_payload ->> 'tripId' is distinct from target_trip_id
    )
    or target_payload ?| array[
      'owner_id',
      'ownerId',
      'actor_id',
      'actorId',
      'mutation_id',
      'mutationId',
      'revision',
      'tombstone',
      'deleted_at',
      'deletedAt'
    ]
    or tripmap_private.account_payload_has_forbidden_key(target_payload)
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'upsert'
     and target_object_type = 'ticket_meta'
     and (
       exists (
         select 1
         from pg_catalog.jsonb_object_keys(target_payload) as ticket_field(field_name)
         where ticket_field.field_name not in (
           'bookingId',
           'createdAt',
           'fileType',
           'id',
           'itemId',
           'mimeType',
           'scope',
           'sharedVisibility',
           'size',
           'storageMode',
           'ticketCategory',
           'title',
           'tripId',
           'updatedAt'
         )
       )
       or not tripmap_private.account_ticket_meta_payload_is_valid(target_payload)
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'upsert'
     and target_object_type in ('ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense')
     and not tripmap_private.account_ledger_payload_is_valid(target_object_type, target_payload) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'upsert'
     and target_object_type = 'item'
     and (
       target_payload ->> 'dayId' is null
       or target_payload ->> 'dayId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or pg_catalog.jsonb_typeof(target_payload -> 'sortOrder') is distinct from 'number'
       or target_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'
       or pg_catalog.jsonb_typeof(target_payload -> 'ticketIds') is distinct from 'array'
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'upsert'
     and target_object_type = 'item'
     and (
       (target_payload ->> 'sortOrder')::numeric > 9007199254740991
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(target_payload -> 'ticketIds') as ticket_id(value)
         where pg_catalog.jsonb_typeof(ticket_id.value) <> 'string'
           or ticket_id.value #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       )
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_array_elements(target_payload -> 'ticketIds') as ticket_id(value)
       ) <> (
         select pg_catalog.count(distinct ticket_id.value #>> '{}')
         from pg_catalog.jsonb_array_elements(target_payload -> 'ticketIds') as ticket_id(value)
       )
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'delete' and target_payload is not null then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'delete_payload_not_allowed'
    );
  end if;

  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'schemaVersion', target_schema_version,
          'accountHash', target_account_hash,
          'mutationId', target_mutation_id,
          'tripId', target_trip_id,
          'objectType', target_object_type,
          'objectId', target_object_id,
          'operation', target_operation,
          'expectedRevision', target_expected_revision,
          'objectSchemaVersion', target_object_schema_version,
          'deviceId', target_device_id,
          'payload', target_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Share the trip lifecycle lock with ordinary writes so a create-only import
  -- can exclusively prove an empty trip scope before committing its graph.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(
      current_user_id::text || ':trip-lifecycle:' || target_trip_id,
      0
    )
  );

  -- Lock the object before any structural day or mutation identity lock.
  -- This also serializes absent-row creates by object identity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_user_id::text || ':' || target_object_type || ':' || target_object_id,
      0
    )
  );

  select *
  into current_object
  from public.tripmap_account_objects
  where owner_id = current_user_id
    and object_type = target_object_type
    and object_id = target_object_id
  for update;
  has_current_object := found;
  current_revision := case when has_current_object then current_object.revision else 0 end;

  if target_object_type = 'ticket_meta'
     or target_object_type in ('ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense')
     or (
       target_operation = 'delete'
       and target_object_type in ('trip', 'day', 'item')
     )
     or (
       target_operation = 'upsert'
       and target_object_type in ('trip', 'day', 'item')
       and has_current_object
       and current_object.tombstone
     )
     or (
       target_object_type = 'item'
       and target_operation = 'upsert'
       and (
         (
           not has_current_object
           and pg_catalog.jsonb_array_length(target_payload -> 'ticketIds') > 0
         )
         or (
           has_current_object
           and not current_object.tombstone
           and (
             current_object.payload -> 'dayId' is distinct from target_payload -> 'dayId'
             or current_object.payload -> 'sortOrder' is distinct from target_payload -> 'sortOrder'
             or current_object.payload -> 'ticketIds' is distinct from target_payload -> 'ticketIds'
           )
         )
       )
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'workflow_required'
    );
  end if;

  -- Lock every affected itinerary day after the object lock and before the
  -- mutation identity lock. Reorder and move workflows use the same namespace.
  if target_object_type = 'item' then
    for structural_day_id in
      select distinct requested_day.day_id
      from (
        values
          (case when target_operation = 'upsert' then target_payload ->> 'dayId' end),
          (case
            when has_current_object and not current_object.tombstone
              then current_object.payload ->> 'dayId'
          end)
      ) as requested_day(day_id)
      where requested_day.day_id is not null
      order by requested_day.day_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          current_user_id::text
            || ':item-day:'
            || target_trip_id
            || ':'
            || structural_day_id,
          0
        )
      );
    end loop;
  end if;

  -- Lock the mutation identity after the object and structural day locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_user_id::text || ':' || target_mutation_id,
      0
    )
  );

  select *
  into prior_receipt
  from tripmap_private.account_mutation_receipts
  where owner_id = current_user_id
    and mutation_id = target_mutation_id;

  if found then
    if prior_receipt.request_hash <> request_hash then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'mutationId', target_mutation_id,
        'reason', 'mutation_id_reused'
      );
    end if;

    select *
    into current_object
    from public.tripmap_account_objects
    where owner_id = current_user_id
      and object_type = prior_receipt.object_type
      and object_id = prior_receipt.object_id;

    if not found then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'mutationId', target_mutation_id,
        'reason', 'receipt_object_missing'
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'idempotent',
      'mutationId', target_mutation_id,
      'appliedRevision', prior_receipt.applied_revision,
      'currentRevision', current_object.revision,
      'object', tripmap_private.account_object_public_json(current_object)
    );
  end if;

  if has_current_object and current_object.trip_id <> target_trip_id then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'object_trip_mismatch'
    );
  end if;

  if current_revision <> target_expected_revision then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'conflict',
      'mutationId', target_mutation_id,
      'reason', 'revision_mismatch',
      'currentRevision', current_revision,
      'currentObject', case
        when has_current_object
          then tripmap_private.account_object_public_json(current_object)
        else null
      end
    );
  end if;

  next_revision := current_revision + 1;
  if has_current_object then
    update public.tripmap_account_objects
    set
      payload = case when target_operation = 'delete' then null else target_payload end,
      schema_version = target_object_schema_version,
      revision = next_revision,
      mutation_id = target_mutation_id,
      actor_id = current_user_id,
      device_id = target_device_id,
      tombstone = target_operation = 'delete',
      deleted_at = case when target_operation = 'delete' then pg_catalog.now() else null end,
      updated_at = pg_catalog.now()
    where owner_id = current_user_id
      and object_type = target_object_type
      and object_id = target_object_id
    returning * into current_object;
  else
    insert into public.tripmap_account_objects (
      owner_id,
      trip_id,
      object_type,
      object_id,
      payload,
      schema_version,
      revision,
      mutation_id,
      actor_id,
      device_id,
      tombstone,
      deleted_at
    )
    values (
      current_user_id,
      target_trip_id,
      target_object_type,
      target_object_id,
      case when target_operation = 'delete' then null else target_payload end,
      target_object_schema_version,
      next_revision,
      target_mutation_id,
      current_user_id,
      target_device_id,
      target_operation = 'delete',
      case when target_operation = 'delete' then pg_catalog.now() else null end
    )
    returning * into current_object;
  end if;

  insert into tripmap_private.account_mutation_receipts (
    owner_id,
    mutation_id,
    request_hash,
    trip_id,
    object_type,
    object_id,
    operation,
    expected_revision,
    applied_revision,
    schema_version,
    actor_id,
    device_id
  )
  values (
    current_user_id,
    target_mutation_id,
    request_hash,
    target_trip_id,
    target_object_type,
    target_object_id,
    target_operation,
    target_expected_revision,
    next_revision,
    target_object_schema_version,
    current_user_id,
    target_device_id
  );

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'mutationId', target_mutation_id,
    'appliedRevision', next_revision,
    'currentRevision', next_revision,
    'object', tripmap_private.account_object_public_json(current_object)
  );
end;
$$;

create or replace function public.account_apply_object_mutation_v1(
  target_schema_version integer,
  target_account_hash text,
  target_mutation_id text,
  target_trip_id text,
  target_object_type text,
  target_object_id text,
  target_operation text,
  target_expected_revision bigint,
  target_object_schema_version integer,
  target_device_id text,
  target_payload jsonb default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.account_apply_object_mutation_v1(
    target_schema_version,
    target_account_hash,
    target_mutation_id,
    target_trip_id,
    target_object_type,
    target_object_id,
    target_operation,
    target_expected_revision,
    target_object_schema_version,
    target_device_id,
    target_payload
  );
$$;

revoke all on function tripmap_private.account_payload_has_forbidden_key(jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_ticket_meta_payload_is_valid(jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_ledger_timestamp_is_valid(text)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_ledger_payload_is_valid(text, jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_redact_ticket_meta_payload(jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_object_public_json(public.tripmap_account_objects)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, text, bigint, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function tripmap_private.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, text, bigint, integer, text, jsonb
) to authenticated, service_role;

revoke all on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, text, bigint, integer, text, jsonb
) from public, anon;
grant execute on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, text, bigint, integer, text, jsonb
) to authenticated, service_role;

-- Copy compatible legacy records without updating or deleting any legacy row.
insert into public.tripmap_account_objects (
  owner_id,
  trip_id,
  object_type,
  object_id,
  payload,
  schema_version,
  revision,
  mutation_id,
  actor_id,
  device_id,
  tombstone,
  deleted_at,
  created_at,
  updated_at
)
select
  legacy.user_id,
  legacy.trip_id,
  legacy.object_type,
  legacy.object_id,
  case
    when legacy.deleted_at_ms is not null then null
    when legacy.object_type = 'ticket_meta' then
      tripmap_private.account_redact_ticket_meta_payload(legacy.payload)
    else legacy.payload
  end,
  1,
  1,
  'legacy_' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        legacy.user_id::text || ':' || legacy.object_type || ':' || legacy.object_id || ':' || legacy.op_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  legacy.user_id,
  coalesce(
    nullif(
      pg_catalog.left(
        pg_catalog.regexp_replace(legacy.device_id, '[^A-Za-z0-9:_-]', '', 'g'),
        128
      ),
      ''
    ),
    'legacy'
  ),
  legacy.deleted_at_ms is not null,
  case
    when legacy.deleted_at_ms is null then null
    else pg_catalog.to_timestamp(legacy.deleted_at_ms::double precision / 1000.0)
  end,
  legacy.created_at,
  legacy.updated_at
from public.cloud_sync_objects as legacy
where legacy.object_type in (
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
)
and (
  legacy.object_type <> 'ticket_meta'
  or tripmap_private.account_ticket_meta_payload_is_valid(
    tripmap_private.account_redact_ticket_meta_payload(legacy.payload)
  )
)
on conflict (owner_id, object_type, object_id) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tripmap_account_objects'
  ) then
    alter publication supabase_realtime add table public.tripmap_account_objects;
  end if;
end;
$$;

comment on table public.tripmap_account_objects is
  'Revisioned TripMap account objects. Sensitive document bodies and file blobs remain in their dedicated encrypted or Storage domains.';
comment on table tripmap_private.account_mutation_receipts is
  'Private idempotency receipts retained independently from the latest object revision.';
comment on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, text, bigint, integer, text, jsonb
) is
  'Authenticated cloud-first object mutation boundary with optimistic revision checks and mutation replay deduplication.';
