import { describe, test, expect } from 'vitest'
import {
  sanitizeAiDraftRepairDraftForProxy,
  sanitizeAiDraftRepairFindingsForProxy,
  summarizeAiPrivacyForAiRequest,
} from './aiPrivacyGuard'
import type { AiTripDraft } from './aiTripDraft'
import type { AiPrivacySettings } from './aiPrivacy'
import type { SanitizedQualityFinding } from './providerProxyContract'

const defaultPrivacy: AiPrivacySettings = {
  allowItineraryBasics: false,
  allowLocationText: false,
  allowCoordinateState: false,
  allowTransportInfo: false,
  allowTicketMetadata: false,
  allowTicketFileNames: false,
  allowNotesSummary: false,
  allowFullNotes: false,
  allowTicketFileContent: false,
  allowCloudSyncStatus: false,
}

const permissivePrivacy: AiPrivacySettings = {
  allowItineraryBasics: true,
  allowLocationText: true,
  allowCoordinateState: true,
  allowTransportInfo: true,
  allowTicketMetadata: true,
  allowTicketFileNames: true,
  allowNotesSummary: true,
  allowFullNotes: true,
  allowTicketFileContent: true,
  allowCloudSyncStatus: true,
}

function sampleDraft(overrides?: Partial<AiTripDraft>): AiTripDraft {
  return {
    title: 'Test Trip',
    destination: 'Tokyo',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    days: [
      {
        date: '2026-06-01',
        title: 'Day 1',
        items: [
          { title: 'Item 1', note: 'A short note' },
          { title: 'Item 2', note: undefined },
          { title: 'Item 3', note: '' },
          {
            title: 'Item 4',
            note: 'A'.repeat(200),
          },
        ],
      },
      {
        date: '2026-06-02',
        items: [
          { title: 'Item 5' },
        ],
      },
    ],
    ...overrides,
  }
}

describe('sanitizeAiDraftRepairDraftForProxy', () => {
  test('strips all notes when privacy is default (all off)', () => {
    const draft = sampleDraft()
    const result = sanitizeAiDraftRepairDraftForProxy(draft, defaultPrivacy)

    for (const day of result.days) {
      for (const item of day.items) {
        expect(item.note).toBeUndefined()
      }
    }
  })

  test('preserves notes when allowFullNotes is on', () => {
    const draft = sampleDraft()
    const result = sanitizeAiDraftRepairDraftForProxy(draft, permissivePrivacy)

    expect(result.days[0].items[0].note).toBe('A short note')
    expect(result.days[0].items[1].note).toBeUndefined()
    expect(result.days[0].items[2].note).toBeUndefined()
    expect(result.days[0].items[3].note).toBe('A'.repeat(200))
    expect(result.days[1].items[0].note).toBeUndefined()
  })

  test('truncates notes when allowNotesSummary is on but allowFullNotes is off', () => {
    const privacy: AiPrivacySettings = { ...defaultPrivacy, allowNotesSummary: true }
    const draft = sampleDraft()
    const result = sanitizeAiDraftRepairDraftForProxy(draft, privacy)

    expect(result.days[0].items[0].note).toBe('A short note')
    expect(result.days[0].items[1].note).toBeUndefined()
    expect(result.days[0].items[2].note).toBeUndefined()
    expect(result.days[0].items[3].note).toBe('A'.repeat(80) + '…')
  })

  test('does not mutate the input draft', () => {
    const draft = sampleDraft()
    const originalNote = draft.days[0].items[0].note
    sanitizeAiDraftRepairDraftForProxy(draft, defaultPrivacy)
    expect(draft.days[0].items[0].note).toBe(originalNote)
  })

  test('handles empty days array', () => {
    const draft: AiTripDraft = {
      title: 'Empty',
      destination: 'Nowhere',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      days: [],
    }
    const result = sanitizeAiDraftRepairDraftForProxy(draft, defaultPrivacy)
    expect(result.days).toEqual([])
    expect(result.title).toBe('Empty')
  })

  test('handles items with no note field', () => {
    const draft: AiTripDraft = {
      title: 'Test',
      destination: 'Test',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      days: [
        { date: '2026-01-01', items: [{ title: 'Item' }] },
      ],
    }
    const result = sanitizeAiDraftRepairDraftForProxy(draft, defaultPrivacy)
    expect(result.days[0].items[0].note).toBeUndefined()
  })

  test('preserves non-note fields unchanged', () => {
    const draft = sampleDraft()
    const result = sanitizeAiDraftRepairDraftForProxy(draft, defaultPrivacy)

    expect(result.title).toBe('Test Trip')
    expect(result.destination).toBe('Tokyo')
    expect(result.days[0].date).toBe('2026-06-01')
    expect(result.days[0].items[0].title).toBe('Item 1')
    expect(result.days[0].title).toBe('Day 1')
  })

  test('malformed privacy settings use safe defaults via trailing false', () => {
    const draft = sampleDraft()
    const malformed = {} as AiPrivacySettings
    const result = sanitizeAiDraftRepairDraftForProxy(draft, malformed)

    for (const day of result.days) {
      for (const item of day.items) {
        expect(item.note).toBeUndefined()
      }
    }
  })
})

describe('sanitizeAiDraftRepairFindingsForProxy', () => {
  test('passes through findings unchanged', () => {
    const findings: SanitizedQualityFinding[] = [
      { ruleId: 'dense_day', severity: 'warning', title: 'Dense', message: 'Too many items', dayDate: '2026-06-01' },
      { ruleId: 'missing_transport', severity: 'warning', title: 'No transport', message: 'Missing transport info' },
    ]
    const result = sanitizeAiDraftRepairFindingsForProxy(findings)
    expect(result).toEqual(findings)
  })

  test('preserves empty array', () => {
    const result = sanitizeAiDraftRepairFindingsForProxy([])
    expect(result).toEqual([])
  })
})

describe('summarizeAiPrivacyForAiRequest', () => {
  test('returns null for generation operation regardless of privacy', () => {
    expect(summarizeAiPrivacyForAiRequest(defaultPrivacy, 'generation')).toBeNull()
    expect(summarizeAiPrivacyForAiRequest(permissivePrivacy, 'generation')).toBeNull()
  })

  test('returns null when all flags are permissive for repair', () => {
    expect(summarizeAiPrivacyForAiRequest(permissivePrivacy, 'repair')).toBeNull()
  })

  test('returns note restriction when allowFullNotes and allowNotesSummary are off', () => {
    const result = summarizeAiPrivacyForAiRequest(defaultPrivacy, 'repair')
    expect(result).toContain('备注内容不会发送')
  })

  test('returns note truncation when allowNotesSummary is on but allowFullNotes is off', () => {
    const privacy: AiPrivacySettings = { ...defaultPrivacy, allowNotesSummary: true }
    const result = summarizeAiPrivacyForAiRequest(privacy, 'repair')
    expect(result).toContain('备注内容会截取前80个字符')
  })

  test('excludes note message when allowFullNotes is on', () => {
    const privacy: AiPrivacySettings = { ...defaultPrivacy, allowFullNotes: true }
    const result = summarizeAiPrivacyForAiRequest(privacy, 'repair')
    expect(result).not.toContain('备注')
  })

  test('includes ticket restriction when allowTicketMetadata is off', () => {
    const result = summarizeAiPrivacyForAiRequest(defaultPrivacy, 'repair')
    expect(result).toContain('票据信息')
  })

  test('includes cloud restriction when allowCloudSyncStatus is off', () => {
    const result = summarizeAiPrivacyForAiRequest(defaultPrivacy, 'repair')
    expect(result).toContain('云端状态')
  })
})
