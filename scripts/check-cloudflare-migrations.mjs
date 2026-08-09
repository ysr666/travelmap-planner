import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const configPath = path.join(root, 'wrangler.provider-maintenance.jsonc')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const binding = config.d1_databases?.find((entry) => entry.binding === 'TRIPMAP_PROVIDER_QUOTA_D1')

if (!binding?.migrations_dir) {
  throw new Error('TRIPMAP_PROVIDER_QUOTA_D1 must declare migrations_dir')
}

const migrationsDir = path.resolve(path.dirname(configPath), binding.migrations_dir)
const migrationNames = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (migrationNames.length === 0) {
  throw new Error(`No D1 migrations found in ${binding.migrations_dir}`)
}

for (const name of migrationNames) {
  const sql = await readFile(path.join(migrationsDir, name), 'utf8')
  if (/^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT)\s*;/imu.test(sql)) {
    throw new Error(`${name} contains an explicit transaction statement that D1 migrations reject`)
  }
}

console.log(`Verified ${migrationNames.length} Cloudflare D1 migrations in ${binding.migrations_dir}.`)
