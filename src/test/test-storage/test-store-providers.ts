import { TEST_STORE_PROVIDERS } from './test-store-providers.constants'

import type { TestStoreProvider } from './test-storage.types'

/**
 * The test store core's test entry provides for `type`, consulted when the type's kind carries no `testStoreOf`; none
 * for another type.
 *
 * @internal store selection when a test project opens
 */
export function testStoreProviderOf(params: { type: string }): TestStoreProvider | undefined {
	return TEST_STORE_PROVIDERS.get(params.type)
}
