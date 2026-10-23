import type { DiagnosticCatalogue } from '@/diagnostics'

/** The tag whose records the contract's import session asks for; every other record passes it by. */
export const CONTRACT_SESSION_TAG = 'B'

/** A record of the session's tag whose `bB` attribute holds this value makes the session fail. */
export const CONTRACT_SESSION_FAIL_VALUE = 'fail'

/** The attribute the contract's import session writes on every record of its tag, after the parse. */
export const CONTRACT_SESSION_SEEN_ATTRIBUTE = 'seen'

/** What the contract's import session says: one diagnostic per record of its tag it was handed. */
export const CONTRACT_SESSION_DIAGNOSTICS = {
	source: 'store-contract',
	codes: {
		seen: { severity: 'information', family: 'import', message: 'Record handed to the session' },
	},
} as const satisfies DiagnosticCatalogue
