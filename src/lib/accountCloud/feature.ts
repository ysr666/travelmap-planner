export const ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION = '20260811092148' as const
export const ACCOUNT_CLOUD_V2_FULL_CUTOVER_READY = false

export type AccountCloudV2Mode = 'disabled' | 'enabled' | 'shadow'

type AccountCloudFeatureEnv = {
  VITE_ACCOUNT_CLOUD_V2_ACCOUNT_HASHES?: string
  VITE_ACCOUNT_CLOUD_V2_MODE?: string
  VITE_ACCOUNT_CLOUD_V2_MIGRATION?: string
}

export function getAccountCloudV2Mode(
  env: AccountCloudFeatureEnv = import.meta.env as AccountCloudFeatureEnv,
): AccountCloudV2Mode {
  const mode = env.VITE_ACCOUNT_CLOUD_V2_MODE?.trim()
  if (mode !== 'shadow' && mode !== 'enabled') return 'disabled'
  if (env.VITE_ACCOUNT_CLOUD_V2_MIGRATION?.trim() !== ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION) {
    return 'disabled'
  }
  return mode
}

export function isAccountCloudV2AccountEnabled(
  accountHash: string | null,
  env: AccountCloudFeatureEnv = import.meta.env as AccountCloudFeatureEnv,
) {
  if (!ACCOUNT_CLOUD_V2_FULL_CUTOVER_READY) return false
  if (!accountHash || getAccountCloudV2Mode(env) !== 'enabled') return false
  const allowlist = (env.VITE_ACCOUNT_CLOUD_V2_ACCOUNT_HASHES ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-f0-9]{32}$/.test(value))
  return allowlist.includes(accountHash.toLowerCase())
}
