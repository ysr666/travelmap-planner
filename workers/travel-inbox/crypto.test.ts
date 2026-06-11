import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, sha256Hex } from './crypto'

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe('travel inbox credential encryption', () => {
  it('round-trips secrets with AES-GCM without plaintext in storage', async () => {
    const encrypted = await encryptJson({ password: 'app-password', username: 'mail@example.com' }, key)
    expect(encrypted).not.toContain('app-password')
    await expect(decryptJson(encrypted, key)).resolves.toEqual({ password: 'app-password', username: 'mail@example.com' })
  })

  it('creates stable SHA-256 fingerprints', async () => {
    await expect(sha256Hex('same')).resolves.toBe(await sha256Hex('same'))
  })
})
