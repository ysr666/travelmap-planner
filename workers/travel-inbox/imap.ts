import type { ConnectorSecret, MailAdapter, MailMessage } from './types'

type SocketLike = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void> | void
}
type SocketFactory = (host: string, port: number) => Promise<SocketLike>

export function createImapAdapter(socketFactory: SocketFactory = cloudflareSocketFactory): MailAdapter {
  return {
    async test(secret, folder) {
      if (secret.kind !== 'imap') throw new Error('invalid_secret_kind')
      validateImapEndpoint(secret.host, secret.port)
      const session = await openSession(secret, socketFactory)
      try { await session.command(`EXAMINE ${quote(folder)}`) } finally { await session.close() }
    },
    async sync(connector, secret) {
      if (secret.kind !== 'imap') throw new Error('invalid_secret_kind')
      validateImapEndpoint(secret.host, secret.port)
      const session = await openSession(secret, socketFactory)
      try {
        const examined = await session.command(`EXAMINE ${quote(connector.mailbox_folder || 'INBOX')}`)
        const uidValidity = Number(examined.text.match(/\[UIDVALIDITY\s+(\d+)\]/i)?.[1]) || 0
        const previousValidity = Number(connector.sync_cursor.uidValidity) || 0
        const lastUid = previousValidity === uidValidity ? Number(connector.sync_cursor.lastUid) || 0 : 0
        const connectedAt = Number(connector.sync_cursor.connectedAt) || Date.now()
        const recoveryDays = previousValidity > 0 && previousValidity !== uidValidity ? Math.max(7, connector.backfill_days) : connector.backfill_days
        const cutoffMs = connectedAt - recoveryDays * 24 * 60 * 60 * 1000
        const searchCriteria = lastUid > 0 ? `UID ${lastUid + 1}:*` : `SINCE ${formatImapDate(cutoffMs)}`
        const searched = await session.command(`UID SEARCH ${searchCriteria}`)
        const uids = (searched.text.match(/^\* SEARCH\s*(.*)$/im)?.[1] ?? '')
          .trim().split(/\s+/).map(Number).filter((uid) => Number.isInteger(uid) && uid > lastUid).slice(0, 50)
        const messages: MailMessage[] = []
        let newestUid = lastUid
        for (const uid of uids) {
          const fetched = await session.command(`UID FETCH ${uid} (UID INTERNALDATE RFC822.SIZE BODY.PEEK[])`)
          if (!fetched.literal) continue
          newestUid = Math.max(newestUid, uid)
          const internalDate = fetched.text.match(/INTERNALDATE\s+"([^"]+)"/i)?.[1]
          const receivedAtMs = internalDate ? Date.parse(internalDate) : Number.NaN
          if (Number.isFinite(receivedAtMs) && receivedAtMs < cutoffMs) continue
          messages.push({
            providerMessageId: `${uidValidity}:${uid}`,
            raw: fetched.literal,
            receivedAt: internalDate ? new Date(internalDate).toISOString() : new Date().toISOString(),
            subject: readSubject(fetched.literal),
          })
        }
        return { cursor: { connectedAt, lastUid: newestUid, uidValidity }, messages }
      } finally {
        await session.close()
      }
    },
  }
}

export function validateImapEndpoint(host: string, port: number) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (port !== 993 || !normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) throw new Error('imap_endpoint_not_allowed')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(':')) throw new Error('imap_endpoint_not_allowed')
  if (!/^[a-z0-9.-]+$/.test(normalized) || !normalized.includes('.')) throw new Error('imap_endpoint_not_allowed')
}

async function openSession(secret: Extract<ConnectorSecret, { kind: 'imap' }>, socketFactory: SocketFactory) {
  const socket = await withTimeout(socketFactory(secret.host, secret.port), 10_000)
  const reader = socket.readable.getReader()
  const writer = socket.writable.getWriter()
  const encoder = new TextEncoder()
  let sequence = 0
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array()
  await readUntilLine(reader, () => true, () => buffered, (value) => { buffered = value })
  async function command(commandText: string) {
    const tag = `A${String(++sequence).padStart(4, '0')}`
    await writer.write(encoder.encode(`${tag} ${commandText}\r\n`))
    return readResponse(reader, tag, () => buffered, (value) => { buffered = value })
  }
  const login = await command(`LOGIN ${quote(secret.username)} ${quote(secret.password)}`)
  if (!new RegExp(`^${login.tag} OK`, 'im').test(login.text)) throw new Error('imap_auth_failed')
  return { command, async close() { try { await command('LOGOUT') } catch { /* ignore */ } writer.releaseLock(); reader.releaseLock(); await socket.close() } }
}

async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  tag: string,
  getBuffer: () => Uint8Array,
  setBuffer: (value: Uint8Array) => void,
) {
  let text = ''
  let literal: Uint8Array | undefined
  while (true) {
    const line = await readUntilLine(reader, () => true, getBuffer, setBuffer)
    text += line + '\r\n'
    const length = Number(line.match(/\{(\d+)\}$/)?.[1])
    if (Number.isFinite(length) && length > 0) literal = await readBytes(reader, length, getBuffer, setBuffer)
    if (line.startsWith(`${tag} `)) return { literal, tag, text }
  }
}

async function readUntilLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  _accept: (line: string) => boolean,
  getBuffer: () => Uint8Array,
  setBuffer: (value: Uint8Array) => void,
) {
  while (true) {
    const buffer = getBuffer()
    const index = findCrlf(buffer)
    if (index >= 0) {
      const line = new TextDecoder().decode(buffer.slice(0, index))
      setBuffer(buffer.slice(index + 2))
      return line
    }
    const result = await withTimeout(reader.read(), 15_000)
    if (result.done) throw new Error('imap_connection_closed')
    setBuffer(concat(buffer, result.value))
  }
}

async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>, length: number, getBuffer: () => Uint8Array, setBuffer: (value: Uint8Array) => void) {
  while (getBuffer().length < length) {
    const result = await withTimeout(reader.read(), 15_000)
    if (result.done) throw new Error('imap_connection_closed')
    setBuffer(concat(getBuffer(), result.value))
  }
  const value = getBuffer().slice(0, length)
  setBuffer(getBuffer().slice(length))
  return value
}

function concat(first: Uint8Array, second: Uint8Array) {
  const value = new Uint8Array(first.length + second.length)
  value.set(first); value.set(second, first.length)
  return value
}

function findCrlf(value: Uint8Array) {
  for (let index = 0; index < value.length - 1; index += 1) if (value[index] === 13 && value[index + 1] === 10) return index
  return -1
}

function quote(value: string) { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` }
function readSubject(raw: Uint8Array) { return new TextDecoder().decode(raw.slice(0, 16_384)).match(/^Subject:\s*(.+)$/im)?.[1]?.trim().slice(0, 240) || '邮件来源' }
function formatImapDate(value: number) {
  const date = new Date(value)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]
  return `${String(date.getUTCDate()).padStart(2, '0')}-${month}-${date.getUTCFullYear()}`
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number) { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('imap_timeout')), timeoutMs))]) }

async function cloudflareSocketFactory(host: string, port: number): Promise<SocketLike> {
  const { connect } = await import('cloudflare:sockets')
  return connect({ hostname: host, port }, { secureTransport: 'on' }) as unknown as SocketLike
}
