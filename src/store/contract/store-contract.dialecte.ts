import { createContractHooks } from './store-contract.import-session'

import { defineDialecte } from '@/dialecte'
import { TEST_DIALECTE } from '@/test/test-dialecte'

/** Core's test dialecte with the contract's import session: what a store leg running the engine elsewhere serves. */
export const CONTRACT_DIALECTE = defineDialecte({
	id: TEST_DIALECTE.id,
	version: TEST_DIALECTE.version,
	configs: TEST_DIALECTE.configs,
	defaultConfigKey: TEST_DIALECTE.defaultConfigKey,
	createHooks: createContractHooks,
})
