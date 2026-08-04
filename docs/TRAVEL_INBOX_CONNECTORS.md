# Travel Inbox Source Connectors

Status: **Current connector baseline + Candidate UI V3 surface**

Travel Inbox is the realtime ingestion layer for an AI-first trip workspace. Account-level Gmail and IMAP connectors continuously discover supported travel messages, while upload, paste, and device-folder flows remain available as explicit fallbacks.

## Product Role

**Target:** new booking or disruption messages create source-bearing Inbox events, trigger registered AI extraction actions, and propose updates to the correct trip without requiring the user to inspect raw email. Read and classification work can run automatically; changes to itinerary, tickets, expenses, or reminders remain previewed and confirmation-gated.

**Current:** Gmail and IMAP use scheduled ingestion, the device folder is local, and AI output is an editable preview. The current five-minute cron and browser-assisted parsing are migration-stage behavior rather than the final realtime job model.

## Candidate UI Surface

The candidate Inbox UI follows [UI V3](UI_REFACTOR_V3.md); it becomes production Current only after merge and release qualification:

- When items exist, the first screen is the pending item list; when empty, it contains one import/connect command.
- Zero metric cards, Provider availability, connector diagnostics, and technical setup do not lead the main Inbox surface.
- Source and connector controls live under a secondary “来源与导入” surface.
- AI classification uses compact states such as processing, needs confirmation, archived, and failed.
- Batch application produces one combined preview and confirmation instead of opening a long form for each source.

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

## Data Lifecycle And Execution Boundaries

- A sync imports at most 50 messages per connector and accepts at most 20 MB and eight attachments per source.
- Pending source objects expire after 30 days. Applying or discarding deletes the RFC822 object immediately and retains a 90-day dedupe tombstone.
- Current browser flows parse MIME and run PDF/OCR extraction on-device. The target job runtime may move bounded extraction server-side, but only through a registered connector action with explicit content limits and source lineage; mailbox credentials are never part of AI input.
- AI output remains a preview. The existing editable diff, confirmation dialog, and baseline fingerprint check guard current writes; the target runtime uses the same confirmation and stale-plan rules against the service-side trip revision.

## Validation

Use fixtures for Gmail, IMAP, Supabase, and provider requests. Do not point automated tests at real providers.

```bash
npm run typecheck:travel-inbox-worker
npm run build
npm run lint
npm run test:unit
npx playwright test e2e/travel-inbox-connectors.spec.ts
```
