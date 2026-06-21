import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DEFAULT_SESSION_PATH = join(homedir(), '.codex', 'secrets', 'tripmap-smoke-session.json')

export async function restoreSupabaseSmokeSession(client, { email, supabaseUrl }) {
  const sessionPath = getSessionPath()
  if (!existsSync(sessionPath)) return null

  try {
    const cached = JSON.parse(readFileSync(sessionPath, 'utf8'))
    if (cached.email !== email || cached.supabaseUrl !== supabaseUrl) return null
    if (!cached.accessToken || !cached.refreshToken) return null

    const { data, error } = await client.auth.setSession({
      access_token: cached.accessToken,
      refresh_token: cached.refreshToken,
    })
    if (error || !data.session) {
      unlinkSync(sessionPath)
      return null
    }

    persistSupabaseSmokeSession(data.session, { email, supabaseUrl })
    return data.session
  } catch {
    unlinkSync(sessionPath)
    return null
  }
}

export function persistSupabaseSmokeSession(session, { email, supabaseUrl }) {
  if (!session?.access_token || !session?.refresh_token) return

  const sessionPath = getSessionPath()
  const temporaryPath = `${sessionPath}.tmp`
  mkdirSync(dirname(sessionPath), { mode: 0o700, recursive: true })
  writeFileSync(temporaryPath, JSON.stringify({
    accessToken: session.access_token,
    email,
    expiresAt: session.expires_at ?? null,
    refreshToken: session.refresh_token,
    supabaseUrl,
  }), { mode: 0o600 })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, sessionPath)
  chmodSync(sessionPath, 0o600)
}

function getSessionPath() {
  return process.env.SUPABASE_SMOKE_SESSION_FILE || DEFAULT_SESSION_PATH
}
