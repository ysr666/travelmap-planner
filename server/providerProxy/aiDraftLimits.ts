/**
 * Per-request resource bounds for AI draft generation.
 *
 * These are orthogonal to the rate-limit quota in quotaGuard.ts:
 * quota controls request count per window; these control per-request
 * prompt size, output size, and embedded user text length.
 *
 * Production deployment needs durable quota (KV / Supabase / Redis)
 * to replace the in-memory Map in quotaGuard.ts.
 */

export const AI_DRAFT_MAX_PROMPT_CHARS = 4000

export const AI_DRAFT_MAX_OUTPUT_TOKENS_HINT = 4000

export const AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS = 500
