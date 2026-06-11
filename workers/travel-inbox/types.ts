export type TravelInboxWorkerEnv = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  TRAVEL_INBOX_CREDENTIAL_KEY: string
  TRAVEL_INBOX_ALLOWED_ORIGINS?: string
  TRAVEL_INBOX_APP_URL: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REDIRECT_URI?: string
}

export type ConnectorRow = {
  id: string
  user_id: string
  kind: 'gmail' | 'imap'
  name: string
  status: 'active' | 'paused' | 'reauth_required' | 'error'
  mailbox_folder: string
  gmail_label_id?: string | null
  auto_ai_enabled: boolean
  sync_cursor: Record<string, unknown>
  backfill_days: 0 | 7 | 30
}

export type ConnectorSecret =
  | { kind: 'gmail'; refreshToken: string }
  | { kind: 'imap'; host: string; port: 993; username: string; password: string }

export type MailMessage = {
  providerMessageId: string
  receivedAt: string
  subject: string
  raw: Uint8Array
}

export type MailSyncResult = {
  cursor: Record<string, unknown>
  messages: MailMessage[]
}

export type MailAdapter = {
  sync(connector: ConnectorRow, secret: ConnectorSecret): Promise<MailSyncResult>
  test?(secret: ConnectorSecret, folder: string): Promise<void>
}
