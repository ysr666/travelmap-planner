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
  if (shouldForceSupabaseUnconfigured()) {
    return {
      configured: false,
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    }
  }

  if (shouldUseE2eSupabaseFixture()) {
    return {
      anonKey: 'tripmap-e2e-fixture-key',
      configured: true,
      missing: [],
      url: 'https://tripmap-e2e.supabase.co',
    }
  }

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

function shouldForceSupabaseUnconfigured() {
  return readLocalE2eFlag('tripmap:e2e:supabase-unconfigured') === '1'
}

function shouldUseE2eSupabaseFixture() {
  return Boolean(readLocalE2eFlag('tripmap:e2e:cloud-fixture'))
}

function readLocalE2eFlag(key: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const hostname = window.location.hostname
    const isLocalTestHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
    if (!isLocalTestHost) {
      return null
    }

    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
