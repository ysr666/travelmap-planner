import { getActiveAccountHash } from '../accountStorageScope'
import {
  isAccountCloudV2AccountEnabled,
  isAccountCloudV2ShadowReadEnabled,
} from './feature'
import type { AccountCloudBootstrapPlanV1 } from './bootstrap'
import type {
  CoreAccountCloudResult,
  CoreAccountObjectByType,
  CoreAccountObjectType,
  CoreCreateInput,
  CoreUpdateInput,
} from './coreMutationRuntime'

export async function createCoreAccountObjectIfEnabled<T extends CoreAccountObjectType>(
  input: CoreCreateInput<T>,
): Promise<CoreAccountCloudResult<CoreAccountObjectByType[T]>> {
  if (!isAccountCloudV2AccountEnabled(getActiveAccountHash())) return { handled: false }
  const runtime = await import('./coreMutationRuntime')
  return runtime.createCoreAccountObject(input)
}

export async function updateCoreAccountObjectIfEnabled<T extends CoreAccountObjectType>(
  input: CoreUpdateInput<T>,
): Promise<CoreAccountCloudResult<CoreAccountObjectByType[T] | undefined>> {
  if (!isAccountCloudV2AccountEnabled(getActiveAccountHash())) return { handled: false }
  const runtime = await import('./coreMutationRuntime')
  return runtime.updateCoreAccountObject(input)
}

export async function prepareAccountCloudShadowBootstrapIfEnabled(
  tripId: string,
): Promise<{ handled: false } | { handled: true; plan: AccountCloudBootstrapPlanV1 }> {
  const accountHash = getActiveAccountHash()
  if (!isAccountCloudV2ShadowReadEnabled(accountHash) || !accountHash) return { handled: false }
  const runtime = await import('./bootstrap')
  return {
    handled: true,
    plan: await runtime.readAndPrepareAccountCloudBootstrapPlanV1({ accountHash, tripId }),
  }
}
