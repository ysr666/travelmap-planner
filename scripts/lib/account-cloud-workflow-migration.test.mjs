import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateAccountCloudWorkflowMigration } from './account-cloud-workflow-migration.mjs'

const migrationSql = await readFile(
  new URL('../../supabase/migrations/20260811134000_account_cloud_workflows_v1.sql', import.meta.url),
  'utf8',
)
const contractSource = await readFile(
  new URL('../../src/lib/accountCloud/workflowContract.ts', import.meta.url),
  'utf8',
)
const objectContractSource = await readFile(
  new URL('../../src/lib/accountCloud/contract.ts', import.meta.url),
  'utf8',
)
const combinedContract = `${contractSource}\n${objectContractSource}`

describe('account cloud workflow migration gate', () => {
  it('keeps the closed workflow registry, Ticket fields, and atomic boundary aligned', () => {
    expect(validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql,
    })).toEqual({
      atomicPreflight: true,
      boundedPayloadTraversal: true,
      deterministicReplayLocks: true,
      importGraphAtomicity: true,
      ledgerGraphAtomicity: true,
      privateReceiptLedger: true,
      structuralGraphLocking: true,
      ticketBindingCompleteness: true,
      workflowCount: 7,
    })
  })

  it('rejects an arbitrary workflow or dynamic SQL escape hatch', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "'trip.repair.apply@1'\n  )),",
        "'trip.repair.apply@1', 'database.run@1'\n  )),",
      ),
    })).toThrow(/workflow receipt IDs/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'current_user_id := auth.uid();',
        "execute target_steps ->> 'sql';\n  current_user_id := auth.uid();",
      ),
    })).toThrow(/dynamic SQL/)
  })

  it('rejects early object writes and browser-readable workflow receipts', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        '-- Preflight every current revision and invariant before the first mutation.',
        'update public.tripmap_account_objects set updated_at = pg_catalog.now();\n  -- Preflight every current revision and invariant before the first mutation.',
      ),
    })).toThrow(/preflight before/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'revoke all on table tripmap_private.account_workflow_receipts from public, anon, authenticated;',
        'grant select on table tripmap_private.account_workflow_receipts to authenticated;',
      ),
    })).toThrow(/account_workflow_receipts/)
  })

  it('rejects Ticket whitelist drift and removal of the account guard', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "             'tripId',\n             'updatedAt'\n           )\n         )\n         or not tripmap_private.account_ticket_meta_payload_is_valid(step_payload)",
        "             'tripId',\n             'updatedAt',\n             'fileName'\n           )\n         )\n         or not tripmap_private.account_ticket_meta_payload_is_valid(step_payload)",
      ),
    })).toThrow(/Ticket metadata fields/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'target_account_hash <> pg_catalog.left(',
        'target_account_hash = pg_catalog.left(',
      ),
    })).toThrow(/account-context guard/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'not tripmap_private.account_ticket_meta_payload_is_valid(step_payload)',
        'false',
      ),
    })).toThrow(/account_ticket_meta_payload_is_valid/)
  })

  it('rejects removal of the bounded payload traversal or its private grant boundary', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace('pg_catalog.count(*) <= 20000', 'pg_catalog.count(*) >= 0'),
    })).toThrow(/pg_catalog.count/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_payload_shape_is_safe(jsonb)',
        'grant execute on function tripmap_private.account_payload_shape_is_safe(jsonb)',
      ),
    })).toThrow(/payload-shape helper/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_workflow_payload_is_safe(jsonb)',
        'grant execute on function tripmap_private.account_workflow_payload_is_safe(jsonb)',
      ),
    })).toThrow(/payload-boundary helper/)
  })

  it('rejects removal of Item structural field validation', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "pg_catalog.jsonb_typeof(step_payload -> 'ticketIds') is distinct from 'array'",
        'false',
      ),
    })).toThrow(/ticketIds/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "step_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'",
        'false',
      ),
    })).toThrow(/sortOrder|Structural workflows/)
  })

  it('rejects moving the receipt lookup ahead of deterministic object and mutation locks', () => {
    const receiptLookup = `  select *
  into prior_receipt
  from tripmap_private.account_workflow_receipts
  where owner_id = current_user_id
    and batch_mutation_id = target_batch_mutation_id;`
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql
        .replace(receiptLookup, '')
        .replace(
          '  -- Match the single-object RPC lock order',
          `${receiptLookup}\n\n  -- Match the single-object RPC lock order`,
        ),
    })).toThrow(/preflight before/)
  })

  it('rejects removal of the complete Ticket rebind baseline', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace("when 'ticket.bind@1' then 1", "when 'ticket.bind@1' then 2"),
    })).toThrow(/ticket.bind@1/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "current_user_id::text || ':ticket-binding:' || ticket_object_id",
        "current_user_id::text || ':ticket-binding-removed:' || ticket_object_id",
      ),
    })).toThrow(/ticket-binding/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "bound_item.payload -> 'ticketIds' ? ticket_object_id",
        'false',
      ),
    })).toThrow(/ticketIds/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "current_item.payload - array['ticketIds', 'updatedAt']::text[]",
        "requested_item.value -> 'payload'",
      ),
    })).toThrow(/ticketIds|updatedAt/)
  })

  it('rejects removal or reordering of structural day locks and complete graph checks', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace("|| ':item-day:'", "|| ':removed-day-lock:'"),
    })).toThrow(/Structural workflows|item-day/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace('structural_item_count <> step_count', 'false'),
    })).toThrow(/Structural workflows|structural_item_count/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace('moved_item_count <> 1', 'moved_item_count < 0'),
    })).toThrow(/Structural workflows|moved_item_count/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        '-- Lock each step mutation identity only after every structural day lock.',
        '-- Mutation lock order removed.',
      ),
    })).toThrow(/Structural workflows/)
  })

  it('rejects removal of the create-only import graph and trip lifecycle boundary', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace("when 'trip.import.commit@1' then 256", "when 'trip.import.commit@1' then 255"),
    })).toThrow(/required contract fragment/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace('create_step.expected_revision <> 0', 'create_step.expected_revision < 0'),
    })).toThrow(/closed create-only graph/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace("|| ':trip-lifecycle:' || target_trip_id", "|| ':removed-trip-lock:' || target_trip_id"),
    })).toThrow(/Structural workflows|trip-lifecycle|exclusively lock/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_import_workflow_shape_is_valid(text, jsonb)',
        'grant execute on function tripmap_private.account_import_workflow_shape_is_valid(text, jsonb)',
      ),
    })).toThrow(/import graph validator/)
  })

  it('rejects removal or exposure of the ledger graph and lock boundary', () => {
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'not tripmap_private.account_ledger_payload_is_valid(step_object_type, step_payload)',
        'false',
      ),
    })).toThrow(/account_ledger_payload_is_valid/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        'revoke all on function tripmap_private.account_ledger_workflow_graph_is_valid(uuid, text, jsonb)',
        'grant execute on function tripmap_private.account_ledger_workflow_graph_is_valid(uuid, text, jsonb)',
      ),
    })).toThrow(/ledger workflow graph validator/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace("|| ':ledger:' || target_trip_id", "|| ':removed-ledger:' || target_trip_id"),
    })).toThrow(/ledger|Structural workflows/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "or (step_object_type = 'ledger_settings' and step_operation = 'delete')",
        'or false',
      ),
    })).toThrow(/ledger_settings/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "current_expense.object_type = 'ledger_expense'",
        "current_expense.object_type = 'removed'",
      ),
    })).toThrow(/current_expense/)
    expect(() => validateAccountCloudWorkflowMigration({
      contractSource: combinedContract,
      migrationSql: migrationSql.replace(
        "step_payload -> 'createdAt' is distinct from current_object.payload -> 'createdAt'",
        'false',
      ),
    })).toThrow(/createdAt/)
  })
})
