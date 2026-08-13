import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { validateAccountCloudMigration } from './lib/account-cloud-migration.mjs'
import { validateAccountCloudWorkflowMigration } from './lib/account-cloud-workflow-migration.mjs'

const root = process.cwd()
const migrationPath = path.join(
  root,
  'supabase/migrations/20260811092148_account_cloud_core_v2.sql',
)
const contractPath = path.join(root, 'src/lib/accountCloud/contract.ts')
const workflowMigrationPath = path.join(
  root,
  'supabase/migrations/20260811134000_account_cloud_workflows_v1.sql',
)
const workflowContractPath = path.join(root, 'src/lib/accountCloud/workflowContract.ts')
const [migrationSql, contractSource, workflowMigrationSql, workflowContractSource] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(contractPath, 'utf8'),
  readFile(workflowMigrationPath, 'utf8'),
  readFile(workflowContractPath, 'utf8'),
])

const result = validateAccountCloudMigration({ contractSource, migrationSql })
const workflowResult = validateAccountCloudWorkflowMigration({
  contractSource: `${workflowContractSource}\n${contractSource}`,
  migrationSql: workflowMigrationSql,
})
console.log(
  `Verified account-cloud V2 migrations: ${result.objectTypeCount} object types, ${workflowResult.workflowCount} atomic workflows, private receipts, and Realtime publication.`,
)
