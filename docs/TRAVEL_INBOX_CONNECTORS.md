# Travel Inbox Source Connectors

Travel Inbox connectors add account-level Gmail and IMAP ingestion plus a device-local folder connector. Existing trip-level paste and upload flows remain available when the connector backend is not configured.

## Deployment Order

1. Apply `supabase/migrations/20260611120000_travel_inbox_source_connectors.sql` and verify the private `travel-inbox-sources` bucket and RLS policies.
2. Deploy `workers/travel-inbox` with `wrangler.travel-inbox.jsonc`; enable the five-minute Cron Trigger.
3. Configure the Gmail OAuth client and callback URL. Public release requires Google's review for the restricted `gmail.readonly` scope.
4. Set `VITE_TRAVEL_INBOX_CONNECTOR_URL` in the frontend and deploy the application.

## Worker Configuration

Set these Worker secrets or variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRAVEL_INBOX_CREDENTIAL_KEY`: base64-encoded 32-byte AES key
- `TRAVEL_INBOX_ALLOWED_ORIGINS`
- `TRAVEL_INBOX_APP_URL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REDIRECT_URI`

The Worker stores only encrypted Gmail refresh tokens and IMAP credentials. The encryption key remains a Worker secret. Gmail sync is read-only. IMAP permits only TLS port 993 and rejects IP literals, localhost, and private hostnames.

## Retention And Privacy

- A sync imports at most 50 messages per connector and accepts at most 20 MB and eight attachments per source.
- Pending source objects expire after 30 days. Applying or discarding deletes the RFC822 object immediately and retains a 90-day dedupe tombstone.
- The browser parses MIME and runs PDF/OCR extraction locally. Provider requests contain extracted text and trip summaries, never the original file or mailbox credentials.
- AI output remains a preview. The existing editable diff, confirmation dialog, and baseline fingerprint check guard the final IndexedDB write.

## Validation

Use fixtures for Gmail, IMAP, Supabase, and provider requests. Do not point automated tests at real providers.

```bash
npm run typecheck:travel-inbox-worker
npm run build
npm run lint
npm run test:unit
npx playwright test e2e/travel-inbox-connectors.spec.ts
```
