import {
	REPEATED_FIXTURE,
	SECOND_FIXTURE_CONFIG,
	SECOND_FIXTURE_DIAGNOSTICS,
	TWO_DIALECTES_FIXTURE,
} from './runtime.fixtures.constants'
import { declareFixtureDialecte } from './runtime.fixtures.dialectes'

import { TEST_DIALECTE_CONFIG } from '@/test/config'
import { TEST_CONFIG_KEY } from '@/test/constant'

/** The second dialecte of the `two-dialectes` fixture worker. */
export const SECOND_FIXTURE_DIALECTE = declareFixtureDialecte({
	id: TWO_DIALECTES_FIXTURE.second.dialecteId,
	version: TWO_DIALECTES_FIXTURE.second.dialecteVersion,
	configKey: SECOND_FIXTURE_CONFIG.key,
	namespaceUri: SECOND_FIXTURE_CONFIG.namespaceUri,
	diagnostics: SECOND_FIXTURE_DIAGNOSTICS,
})

/** The first dialecte's id again, at another version and with other hooks: the declaration found first is served. */
export const REPEATED_FIXTURE_DIALECTE = declareFixtureDialecte({
	id: TWO_DIALECTES_FIXTURE.first.dialecteId,
	version: REPEATED_FIXTURE.dialecteVersion,
	configKey: TEST_CONFIG_KEY,
	namespaceUri: TEST_DIALECTE_CONFIG.namespaces.default.uri,
	diagnostics: REPEATED_FIXTURE.diagnostics,
})
