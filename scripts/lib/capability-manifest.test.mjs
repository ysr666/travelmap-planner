import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateCapabilityManifest } from './capability-manifest.mjs'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const manifestPath = fileURLToPath(new URL('../../config/product-capabilities.json', import.meta.url))

async function readManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'))
}

describe('product capability manifest', () => {
  it('accepts the repository capability truth', async () => {
    const result = await validateCapabilityManifest(await readManifest(), { rootDir })

    expect(result.productStatus).toBe('limited_beta')
    expect(result.capabilityCount).toBeGreaterThan(20)
    expect(result.incompleteReleaseBlockers).toBeGreaterThan(0)
  })

  it('rejects unknown fields', async () => {
    const manifest = await readManifest()
    manifest.capabilities[0].arbitraryClaim = true

    await expect(validateCapabilityManifest(manifest, { rootDir }))
      .rejects.toThrow('contains unknown field arbitraryClaim')
  })

  it('requires implementation, tests, receipts, and no gaps for Current', async () => {
    const manifest = await readManifest()
    manifest.capabilities[0].evidence.tests = []
    manifest.capabilities[0].gaps = ['still incomplete']

    await expect(validateCapabilityManifest(manifest, { rootDir }))
      .rejects.toThrow('current capability needs test evidence')
  })

  it('refuses a full-product claim while release blockers remain incomplete', async () => {
    const manifest = await readManifest()
    manifest.productStatus = 'full_product'

    await expect(validateCapabilityManifest(manifest, { rootDir }))
      .rejects.toThrow('full_product has incomplete release blockers')
  })

  it('rejects dependency cycles', async () => {
    const manifest = await readManifest()
    const shell = manifest.capabilities.find((capability) => capability.id === 'ui.app-shell')
    shell.dependencies = ['ui.visual-baseline']

    await expect(validateCapabilityManifest(manifest, { rootDir }))
      .rejects.toThrow('capability dependency cycle')
  })

  it('rejects evidence outside the repository', async () => {
    const manifest = await readManifest()
    manifest.sourcePlan = '../outside.md'

    await expect(validateCapabilityManifest(manifest, { rootDir }))
      .rejects.toThrow('must stay inside the repository')
  })
})
