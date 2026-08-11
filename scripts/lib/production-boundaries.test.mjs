import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBuiltArtifact } from './production-boundaries.mjs'

async function withArtifact(files, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tripmap-production-boundary-'))
  try {
    for (const [file, contents] of Object.entries(files)) {
      const destination = path.join(directory, file)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, contents)
    }
    return await callback(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

describe('built artifact production boundaries', () => {
  it('accepts an artifact without fixture or bypass markers', async () => {
    const result = await withArtifact({
      'assets/index.js': 'console.log("tripmap")',
      'index.html': '<main>TripMap</main>',
    }, (distDir) => validateBuiltArtifact({ distDir, mode: 'production' }))

    expect(result.fixtureFileCount).toBe(0)
  })

  it('rejects fixture files in an ordinary production artifact', async () => {
    await expect(withArtifact({
      'fixtures/product-fidelity/photo.webp': 'fixture',
      'index.html': '<main>TripMap</main>',
    }, (distDir) => validateBuiltArtifact({ distDir, mode: 'production' })))
      .rejects.toThrow('production artifact contains fixture files')
  })

  it('rejects embedded E2E session supplement markers', async () => {
    await expect(withArtifact({
      'assets/index.js': 'const key="tripmap:e2e:travel-object-context-v1"',
      'index.html': '<main>TripMap</main>',
    }, (distDir) => validateBuiltArtifact({ distDir, mode: 'production' })))
      .rejects.toThrow('contains forbidden marker')
  })

  it('accepts only the registered fixture set in explicit E2E mode', async () => {
    const result = await withArtifact({
      'fixtures/product-fidelity/one.webp': 'one',
      'fixtures/product-fidelity/two.webp': 'two',
      'index.html': '<main>TripMap</main>',
    }, (distDir) => validateBuiltArtifact({
      distDir,
      expectedFixtureFiles: [
        'fixtures/product-fidelity/one.webp',
        'fixtures/product-fidelity/two.webp',
      ],
      mode: 'e2e',
    }))

    expect(result.fixtureFileCount).toBe(2)
  })

  it('rejects missing or unregistered E2E fixtures', async () => {
    await expect(withArtifact({
      'fixtures/product-fidelity/unregistered.webp': 'fixture',
      'index.html': '<main>TripMap</main>',
    }, (distDir) => validateBuiltArtifact({
      distDir,
      expectedFixtureFiles: ['fixtures/product-fidelity/expected.webp'],
      mode: 'e2e',
    }))).rejects.toThrow('unregistered fixture')
  })
})
