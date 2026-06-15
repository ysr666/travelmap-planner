import type { AccountAiPreferences } from '../types'
import { getSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'

const STORAGE_KEY = 'tripmap:account-ai-preferences'
const PRIVACY_VERSION = 1

const defaults: AccountAiPreferences = {
  autoExpenseAiEnabled: false,
  privacyVersion: PRIVACY_VERSION,
}

export function getStoredAccountAiPreferences(): AccountAiPreferences {
  if (typeof window === 'undefined') return defaults
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AccountAiPreferences>
    return normalizePreferences(parsed)
  } catch {
    return defaults
  }
}

export async function getAccountAiPreferences() {
  const local = getStoredAccountAiPreferences()
  if (!getSupabaseConfigStatus().configured) return local
  const client = getSupabaseClient()
  if (!client) return local
  const user = (await client.auth.getUser()).data.user
  if (!user) return local
  const { data, error } = await client
    .from('account_ai_preferences')
    .select('auto_expense_ai_enabled, consented_at, privacy_version')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !data) return local
  const preferences = normalizePreferences({
    autoExpenseAiEnabled: data.auto_expense_ai_enabled,
    consentedAt: data.consented_at ?? undefined,
    privacyVersion: data.privacy_version,
  })
  storePreferences(preferences)
  return preferences
}

export async function saveAccountAiPreferences(autoExpenseAiEnabled: boolean) {
  const preferences: AccountAiPreferences = {
    autoExpenseAiEnabled,
    consentedAt: autoExpenseAiEnabled ? new Date().toISOString() : undefined,
    privacyVersion: PRIVACY_VERSION,
  }
  storePreferences(preferences)
  if (!getSupabaseConfigStatus().configured) return preferences
  const client = getSupabaseClient()
  if (!client) return preferences
  const user = (await client.auth.getUser()).data.user
  if (!user) return preferences
  const { error } = await client.from('account_ai_preferences').upsert({
    auto_expense_ai_enabled: preferences.autoExpenseAiEnabled,
    consented_at: preferences.consentedAt ?? null,
    privacy_version: preferences.privacyVersion,
    user_id: user.id,
  }, { onConflict: 'user_id' })
  if (error) throw new Error('保存自动账单 AI 设置失败。')
  return preferences
}

function normalizePreferences(value: Partial<AccountAiPreferences>): AccountAiPreferences {
  return {
    autoExpenseAiEnabled: value.autoExpenseAiEnabled === true,
    consentedAt: typeof value.consentedAt === 'string' ? value.consentedAt : undefined,
    privacyVersion: Number.isInteger(value.privacyVersion) ? Number(value.privacyVersion) : PRIVACY_VERSION,
  }
}

function storePreferences(preferences: AccountAiPreferences) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Restricted storage keeps the in-memory defaults.
  }
}
