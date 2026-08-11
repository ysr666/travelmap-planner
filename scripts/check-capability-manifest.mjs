import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateCapabilityManifest } from './lib/capability-manifest.mjs'
import { validateRepositoryReleaseClaims } from './lib/release-claims.mjs'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = fileURLToPath(new URL('../config/product-capabilities.json', import.meta.url))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const summary = await validateCapabilityManifest(manifest, { rootDir })
const releaseClaims = await validateRepositoryReleaseClaims({
  productStatus: summary.productStatus,
  rootDir,
})
const counts = Object.entries(summary.statusCounts)
  .filter(([, count]) => count > 0)
  .map(([status, count]) => `${status}=${count}`)
  .join(', ')

console.log(
  `Capability manifest passed: ${summary.capabilityCount} capabilities, ${counts}, `
  + `${summary.incompleteReleaseBlockers} incomplete release blockers, `
  + `${releaseClaims.documentCount} aligned release documents.`,
)
