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
      '  target_schema_version integer,\n  target_mutation_id text,',
      '  target_schema_version integer,\n  owner_id uuid,\n  target_mutation_id text,',
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

  it('rejects any destructive legacy-table statement', () => {
    expect(() => validateAccountCloudMigration({
      contractSource,
      migrationSql: `${migrationSql}\nupdate public.cloud_sync_objects set op_id = op_id;`,
    })).toThrow('must not modify legacy cloud-sync rows')
  })
})
