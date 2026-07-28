import { spawnSync } from 'node:child_process'
import { HISTORICAL_PWA_RELEASES } from '../e2e/pwaHistoricalBuilds.ts'

const workspaceRoot = process.cwd()
const configuredRevision = process.env.PWA_CURRENT_REVISION?.trim()
if (configuredRevision && !/^[0-9a-f]{40}$/.test(configuredRevision)) {
  throw new Error('PWA_CURRENT_REVISION must be a full Git commit SHA')
}
const currentRevision = configuredRevision ?? 'HEAD'

for (const release of HISTORICAL_PWA_RELEASES) {
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', release.commit, currentRevision],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status ?? 'unknown'}`
    throw new Error(`Historical PWA lineage check failed for ${release.label}: ${detail}`)
  }
}

console.log(`Historical PWA lineage verified for ${HISTORICAL_PWA_RELEASES.length} releases.`)
