import { TEST_STORE_PROVIDERS } from './test-store-providers.constants'

import type { TestStoreProvider } from './test-storage.types'

/**
 * The test store core's test entry provides for `type`, consulted when the type's kind carries no `testStoreOf`.
 *
 * @internal the test entry's own providers
 */
export function registerTestStoreProvider(params: {
	type: string
	testStoreOf: TestStoreProvider
}): void {
	TEST_STORE_PROVIDERS.set(params.type, params.testStoreOf)
}

/**
 * The test store core's test entry provides for `type`, or none.
 *
 * @internal store selection when a test project opens
 */
export function testStoreProviderOf(params: { type: string }): TestStoreProvider | undefined {
	return TEST_STORE_PROVIDERS.get(params.type)
}
