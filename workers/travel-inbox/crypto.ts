const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function encryptJson(value: unknown, base64Key: string) {
  const key = await importAesKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, plaintext)
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`
}

export async function decryptJson<T>(value: string, base64Key: string): Promise<T> {
  const [version, ivValue, ciphertextValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !ciphertextValue) throw new Error('invalid_secret')
  const key = await importAesKey(base64Key)
  const plaintext = await crypto.subtle.decrypt(
    { iv: fromBase64(ivValue), name: 'AES-GCM' },
    key,
    fromBase64(ciphertextValue),
  )
  return JSON.parse(decoder.decode(plaintext)) as T
}

export async function sha256Hex(value: Uint8Array | string) {
  const source = typeof value === 'string' ? encoder.encode(value) : value
  const input = new Uint8Array(source.byteLength)
  input.set(source)
  const digest = await crypto.subtle.digest('SHA-256', input.buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function importAesKey(base64Key: string) {
  const bytes = fromBase64(base64Key)
  if (bytes.length !== 32) throw new Error('credential_key_must_be_32_bytes')
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return crypto.subtle.importKey('raw', copy.buffer, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
