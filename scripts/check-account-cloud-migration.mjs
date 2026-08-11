import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { validateAccountCloudMigration } from './lib/account-cloud-migration.mjs'

const root = process.cwd()
const migrationPath = path.join(
  root,
  'supabase/migrations/20260811092148_account_cloud_core_v2.sql',
)
const contractPath = path.join(root, 'src/lib/accountCloud/contract.ts')
const [migrationSql, contractSource] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(contractPath, 'utf8'),
])

const result = validateAccountCloudMigration({ contractSource, migrationSql })
console.log(
  `Verified account-cloud V2 migration: ${result.objectTypeCount} object types, private receipts, and Realtime publication.`,
)
