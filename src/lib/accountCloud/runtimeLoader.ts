import { getActiveAccountHash } from '../accountStorageScope'
import { isAccountCloudV2AccountEnabled } from './feature'
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
