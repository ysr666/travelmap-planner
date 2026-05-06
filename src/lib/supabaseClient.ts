import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'

type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

export type SupabaseConfigStatus =
  | {
      configured: true
      url: string
      anonKey: string
      missing: []
    }
  | {
      configured: false
      url?: string
      anonKey?: string
      missing: string[]
    }

let cachedClient: SupabaseClient | null = null
let cachedKey = ''

export function getSupabaseConfigStatus(env: SupabaseEnv = import.meta.env): SupabaseConfigStatus {
  const url = env.VITE_SUPABASE_URL?.trim()
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim()
  const missing = [
    ...(url ? [] : ['VITE_SUPABASE_URL']),
    ...(anonKey ? [] : ['VITE_SUPABASE_ANON_KEY']),
  ]

  if (url && anonKey) {
    return { anonKey, configured: true, missing: [], url }
  }

  return {
    ...(url ? { url } : {}),
    ...(anonKey ? { anonKey } : {}),
    configured: false,
    missing,
  }
}

export function getSupabaseClient() {
  const status = getSupabaseConfigStatus()
  if (!status.configured) {
    return null
  }

  const key = `${status.url}|${status.anonKey}`
  if (!cachedClient || cachedKey !== key) {
    cachedClient = createClient(status.url, status.anonKey)
    cachedKey = key
  }

  return cachedClient
}

export function requireSupabaseClient() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('云端备份未配置，请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。')
  }

  return client
}

export type { Session, User }
