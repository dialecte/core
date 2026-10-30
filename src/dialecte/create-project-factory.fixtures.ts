import { defineDialecte } from './define-dialecte'

import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { DialecteHooks } from '@/types'

/** Where the factory says the dialecte's engine worker is served. */
export const ENGINE_URL = 'https://dialecte.test/assets/engine.worker.js'

/** Core's test dialecte under two configs, with a query extension counting its `A` elements. */
export function createCountingDialecte(params?: {
	createHooks?: () => DialecteHooks<typeof TEST_DIALECTE_CONFIG>
}) {
	return defineDialecte({
		id: 'core/test',
		version: '0.0.0',
		configs: { first: TEST_DIALECTE_CONFIG, second: TEST_DIALECTE_CONFIG },
		defaultConfigKey: 'first',
		extensions: {
			counting: {
				query: {
					countA: async function countA(query: {
						getRecordsByTagName: (tagName: 'A') => Promise<unknown[]>
					}) {
						const records = await query.getRecordsByTagName('A')
						return records.length
					},
				},
			},
		},
		createHooks: params?.createHooks,
	})
}
