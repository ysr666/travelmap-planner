import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { validateAccountCloudMigration } from './account-cloud-migration.mjs'

let migrationSql = ''
let contractSource = ''

beforeAll(async () => {
  [migrationSql, contractSource] = await Promise.all([
    readFile(path.join(process.cwd(), 'supabase/migrations/20260811092148_account_cloud_core_v2.sql'), 'utf8'),
    readFile(path.join(process.cwd(), 'src/lib/accountCloud/contract.ts'), 'utf8'),
  ])
})

describe('account-cloud migration contract', () => {
  it('accepts the checked-in additive migration', () => {
    expect(validateAccountCloudMigration({ contractSource, migrationSql })).toEqual({
      objectTypeCount: 22,
      receiptLedger: true,
      realtimePublished: true,
      structuralDayLocking: true,
    })
  })

  it('rejects object-type drift between TypeScript and SQL', () => {
    const changed = migrationSql.replace("      'shared_task',\n      'ai_job',", "      'ai_job',")
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: changed }))
      .toThrow('table object types do not match')
  })

  it('rejects direct authenticated writes', () => {
    const changed = migrationSql.replace(
      'grant select on table public.tripmap_account_objects to authenticated;',
      'grant select on table public.tripmap_account_objects to authenticated;\n'
        + 'grant update on table public.tripmap_account_objects to authenticated;',
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: changed }))
      .toThrow('direct account-object write grants')
  })

  it('rejects owner or actor IDs in the client-callable mutation signature', () => {
    const changed = migrationSql.replace(
      '  target_schema_version integer,\n  target_account_hash text,',
      '  target_schema_version integer,\n  owner_id uuid,\n  target_account_hash text,',
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: changed }))
      .toThrow('must not accept owner or actor IDs')
  })

  it('rejects removal of revision or replay-content guards', () => {
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace('current_revision <> target_expected_revision', 'current_revision = current_revision'),
    })).toThrow('expected-revision guard')
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace('prior_receipt.request_hash <> request_hash', 'prior_receipt.request_hash = request_hash'),
    })).toThrow('replay validation')
  })

  it('rejects removal of item structural validation or day locking', () => {
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace("|| ':item-day:'", "|| ':removed-day-lock:'"),
    })).toThrow(/item-day|structural fields and lock/)
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        "target_payload ->> 'dayId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'",
        'false',
      ),
    })).toThrow(/dayId|structural fields and lock/)
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        "pg_catalog.jsonb_typeof(target_payload -> 'ticketIds') is distinct from 'array'",
        'false',
      ),
    })).toThrow(/ticketIds/)
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        '-- Lock the mutation identity after the object and structural day locks.',
        '-- Lock removed.',
      ),
    })).toThrow('structural fields and lock')
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        "current_object.payload -> 'ticketIds' is distinct from target_payload -> 'ticketIds'",
        'false',
      ),
    })).toThrow(/ticketIds/)
  })

  it('rejects removal of the authenticated account-context guard', () => {
    const changed = migrationSql.replace(
      'target_account_hash <> pg_catalog.left(',
      'target_account_hash = target_account_hash or pg_catalog.left(',
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: changed }))
      .toThrow('account-context guard')
  })

  it('rejects Ticket metadata whitelist drift between TypeScript and SQL', () => {
    const changed = migrationSql.replace(
      "           'tripId',\n           'updatedAt'\n         )\n       )\n       or not tripmap_private.account_ticket_meta_payload_is_valid(target_payload)",
      "           'tripId'\n         )\n       )\n       or not tripmap_private.account_ticket_meta_payload_is_valid(target_payload)",
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: changed }))
      .toThrow('Ticket metadata fields do not match')
  })

  it('rejects removal or exposure of the Ticket metadata semantic validator', () => {
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        'not tripmap_private.account_ticket_meta_payload_is_valid(target_payload)',
        'false',
      ),
    })).toThrow(/account_ticket_meta_payload_is_valid/)
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_ticket_meta_payload_is_valid(jsonb)',
        'grant execute on function tripmap_private.account_ticket_meta_payload_is_valid(jsonb)',
      ),
    })).toThrow(/Ticket metadata validator/)
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_redact_ticket_meta_payload(jsonb)',
        'grant execute on function tripmap_private.account_redact_ticket_meta_payload(jsonb)',
      ),
    })).toThrow(/legacy Ticket redactor/)
  })

  it('rejects a stale RPC comment signature or missing overload cleanup', () => {
    const staleComment = migrationSql.replace(
      'integer, text, text, text, text, text, text, bigint, integer, text, jsonb\n) is',
      'integer, text, text, text, text, text, bigint, integer, text, jsonb\n) is',
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: staleComment }))
      .toThrow('current 11-argument signature')

    const missingDrop = migrationSql.replace(
      'drop function if exists public.account_apply_object_mutation_v1(',
      '-- removed public overload cleanup (',
    )
    expect(() => validateAccountCloudMigration({ contractSource, migrationSql: missingDrop }))
      .toThrow('superseded public RPC overload')
  })

  it('rejects any destructive legacy-table statement', () => {
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: `${migrationSql}\nupdate public.cloud_sync_objects set op_id = op_id;`,
    })).toThrow('must not modify legacy cloud-sync rows')
  })
})
