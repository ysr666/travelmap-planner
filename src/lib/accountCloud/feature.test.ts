import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION,
  getAccountCloudV2Mode,
  isAccountCloudV2AccountEnabled,
  isAccountCloudV2ShadowReadEnabled,
} from './feature'

const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'

describe('account cloud v2 feature gate', () => {
  it('stays disabled unless both the mode and exact migration receipt are present', () => {
    expect(getAccountCloudV2Mode({})).toBe('disabled')
    expect(getAccountCloudV2Mode({ VITE_ACCOUNT_CLOUD_V2_MODE: 'enabled' })).toBe('disabled')
    expect(getAccountCloudV2Mode({
      VITE_ACCOUNT_CLOUD_V2_MIGRATION: 'wrong',
      VITE_ACCOUNT_CLOUD_V2_MODE: 'enabled',
    })).toBe('disabled')
    expect(getAccountCloudV2Mode({
      VITE_ACCOUNT_CLOUD_V2_MIGRATION: ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION,
      VITE_ACCOUNT_CLOUD_V2_MODE: 'shadow',
    })).toBe('shadow')
    expect(getAccountCloudV2Mode({
      VITE_ACCOUNT_CLOUD_V2_MIGRATION: ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION,
      VITE_ACCOUNT_CLOUD_V2_MODE: 'enabled',
    })).toBe('enabled')
  })

  it('cannot be enabled by environment values while the checked-in cutover gate is closed', () => {
    const env = {
      VITE_ACCOUNT_CLOUD_V2_ACCOUNT_HASHES: `bad, ${ACCOUNT_HASH.toUpperCase()}`,
      VITE_ACCOUNT_CLOUD_V2_MIGRATION: ACCOUNT_CLOUD_V2_REQUIRED_MIGRATION,
      VITE_ACCOUNT_CLOUD_V2_MODE: 'enabled',
    }
    expect(isAccountCloudV2AccountEnabled(ACCOUNT_HASH, env)).toBe(false)
    expect(isAccountCloudV2AccountEnabled('ffffffffffffffffffffffffffffffff', env)).toBe(false)
    expect(isAccountCloudV2AccountEnabled(null, env)).toBe(false)
    expect(isAccountCloudV2AccountEnabled(ACCOUNT_HASH, {
      ...env,
      VITE_ACCOUNT_CLOUD_V2_MODE: 'shadow',
    })).toBe(false)
    expect(isAccountCloudV2ShadowReadEnabled(ACCOUNT_HASH, {
      ...env,
      VITE_ACCOUNT_CLOUD_V2_MODE: 'shadow',
    })).toBe(false)
  })
})
