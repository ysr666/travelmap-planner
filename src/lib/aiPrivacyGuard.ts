import type { AiPrivacySettings } from './aiPrivacy'
import type { AiTripDraft } from './aiTripDraft'
import type { SanitizedQualityFinding } from './providerProxyContract'

const MAX_TRUNCATED_NOTE_LENGTH = 80

/**
 * Sanitize an AI trip draft for repair requests based on privacy settings.
 *
 * Rules:
 * - If allowFullNotes is on: notes pass through unchanged.
 * - If allowNotesSummary is on but allowFullNotes is off: notes are truncated to 80 chars.
 * - If allowFullNotes and allowNotesSummary are both off: notes are completely removed.
 * - All other fields (title, times, locations, transport) pass through unchanged.
 * - The input draft is never mutated.
 */
export function sanitizeAiDraftRepairDraftForProxy(
  draft: AiTripDraft,
  privacy: AiPrivacySettings,
): AiTripDraft {
  return {
    ...draft,
    days: draft.days.map((day) => ({
      ...day,
      items: day.items.map((item) => ({
        ...item,
        note: sanitizeNote(item.note, privacy),
      })),
    })),
  }
}

function sanitizeNote(note: string | undefined, privacy: AiPrivacySettings): string | undefined {
  if (note === undefined || note === '') {
    return undefined
  }

  if (privacy.allowFullNotes) {
    return note
  }

  if (privacy.allowNotesSummary) {
    return note.length <= MAX_TRUNCATED_NOTE_LENGTH
      ? note
      : note.slice(0, MAX_TRUNCATED_NOTE_LENGTH) + '…'
  }

  return undefined
}

/**
 * Sanitize quality findings for repair requests.
 *
 * Quality findings from the local checker do not contain raw note content
 * (they reference titles, dates, times). If a future finding type could
 * include note text, the check should be added here.
 */
export function sanitizeAiDraftRepairFindingsForProxy(
  findings: SanitizedQualityFinding[],
): SanitizedQualityFinding[] {
  return findings
}

/**
 * Return a short Chinese description of what the privacy settings exclude
 * from a given operation. Returns null if all relevant settings are permissive
 * (no restrictions worth warning about).
 */
export function summarizeAiPrivacyForAiRequest(
  privacy: AiPrivacySettings,
  operation: 'generation' | 'repair',
): string | null {
  if (operation === 'generation') {
    return null
  }

  const restrictions: string[] = []

  if (!privacy.allowFullNotes && !privacy.allowNotesSummary) {
    restrictions.push('备注内容不会发送')
  } else if (!privacy.allowFullNotes && privacy.allowNotesSummary) {
    restrictions.push('备注内容会截取前80个字符')
  }

  if (!privacy.allowTicketMetadata) {
    restrictions.push('票据信息不会发送')
  }

  if (!privacy.allowCloudSyncStatus) {
    restrictions.push('云端状态不会发送')
  }

  if (restrictions.length === 0) {
    return null
  }

  return restrictions.join('，') + '。'
}
