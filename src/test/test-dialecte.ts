import { TEST_DIALECTE_CONFIG } from './config'
import { TEST_CONFIG_KEY } from './constant'

import { defineDialecte } from '@/dialecte'

/** Core's own dialecte: the generated test schema, one config, no extensions, no hooks. */
export const TEST_DIALECTE = defineDialecte({
	id: 'core/test',
	version: '0.0.0',
	configs: { [TEST_CONFIG_KEY]: TEST_DIALECTE_CONFIG },
	defaultConfigKey: TEST_CONFIG_KEY,
})
