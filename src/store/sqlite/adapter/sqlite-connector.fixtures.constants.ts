import { CONTRACT_SESSION_DIAGNOSTICS } from '../../contract/store-contract.constants'
import { CONTRACT_DIALECTE } from '../../contract/store-contract.dialecte'
import {
	SECOND_FIXTURE_CONFIG,
	SECOND_FIXTURE_DIAGNOSTICS,
} from '../runtime/runtime.fixtures.constants'
import { SECOND_FIXTURE_DIALECTE } from '../runtime/runtime.fixtures.dialectes.constants'

import { TEST_DIALECTE_CONFIG } from '@/test/config'

/**
 * The two dialectes of the `two-dialectes` fixture worker, as an app that registers one worker for both names them:
 * the declaration, the namespace its files are written in, and the source its own hooks say their diagnostics under.
 */
export const TWO_DIALECTES_PROJECTS = {
	first: {
		dialecte: CONTRACT_DIALECTE,
		namespaceUri: TEST_DIALECTE_CONFIG.namespaces.default.uri,
		source: CONTRACT_SESSION_DIAGNOSTICS.source,
	},
	second: {
		dialecte: SECOND_FIXTURE_DIALECTE,
		namespaceUri: SECOND_FIXTURE_CONFIG.namespaceUri,
		source: SECOND_FIXTURE_DIAGNOSTICS.source,
	},
} as const
