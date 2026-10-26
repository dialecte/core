import {
	CONTRACT_SESSION_DIAGNOSTICS,
	CONTRACT_SESSION_FAIL_VALUE,
	CONTRACT_SESSION_HOLD_VALUE,
	CONTRACT_SESSION_SEEN_ATTRIBUTE,
	CONTRACT_SESSION_TAG,
} from './store-contract.constants'

import { createDiagnostic } from '@/diagnostics'
import { TEST_DIALECTE_CONFIG } from '@/test/config'
import { TEST_CONFIG_KEY } from '@/test/constant'

import type { ContractImportHold } from './store-contract.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { AnyDialecteConfig, AnyRawRecord, DialecteHooks, ImportSession } from '@/types'

/** The hold a case took: the next session handed a record holding the hold value waits for it. */
let pendingHold: { markReached: () => void; released: Promise<void> } | undefined

/**
 * Hold the next contract import whose file has a record of the session's tag with `bB` set to the
 * hold value: its session says it has `reached` the end of the parse, then waits until `release`.
 * Same realm only: a store behind a worker runs its own copy of this module.
 */
export function holdContractImport(): ContractImportHold {
	let markReached: () => void = () => {}
	const reached = new Promise<void>((resolve) => {
		markReached = resolve
	})
	let release: () => void = () => {}
	const released = new Promise<void>((resolve) => {
		release = resolve
	})
	pendingHold = { markReached, released }
	return { reached, release }
}

/**
 * Wait until the held import has reached its hold. An import that fails first fails the case at once
 * (never waits for the test's timeout); one that completes without reaching the hold fails it too.
 */
export function untilHeld(params: {
	hold: ContractImportHold
	importing: Promise<unknown>
}): Promise<void> {
	const { hold, importing } = params
	return Promise.race([
		hold.reached,
		importing.then(function completedUnheld() {
			throw new Error('the import completed without reaching the hold')
		}),
	])
}

/** Whether a record of the session's tag has `bB` set to `value`. */
function hasMarkedRecord(params: { handed: { record: AnyRawRecord }[]; value: string }): boolean {
	const { handed, value } = params
	return handed.some(({ record }) =>
		record.attributes.some((attribute) => attribute.name === 'bB' && attribute.value === value),
	)
}

/**
 * The import session every contract leg runs. Its behaviour is read from the file - a store behind a
 * worker cannot be handed a test's own hooks: it asks for the records of one tag only, says one
 * diagnostic per record it was handed (with the tag names of its open ancestors), marks each with an
 * attribute after the parse, fails when one of them has `bB` set to the fail value, and waits for the
 * case's release when one has it set to the hold value (`holdContractImport`).
 */
function createContractImportSession(): ImportSession {
	const handed: { record: AnyRawRecord; ancestry: string[] }[] = []
	return {
		recordTagNames: [CONTRACT_SESSION_TAG],
		beforeImportRecord: ({ record, ancestry }) => {
			handed.push({ record, ancestry: ancestry.map((ancestor) => ancestor.tagName) })
		},
		afterImport: async () => {
			const hold = pendingHold
			if (hold && hasMarkedRecord({ handed, value: CONTRACT_SESSION_HOLD_VALUE })) {
				pendingHold = undefined
				hold.markReached()
				await hold.released
			}
			const failing = handed.find(({ record }) =>
				record.attributes.some(
					(attribute) => attribute.name === 'bB' && attribute.value === CONTRACT_SESSION_FAIL_VALUE,
				),
			)
			if (failing) throw new Error(`the contract session fails on record ${failing.record.id}`)
			return {
				updates: handed.map(({ record }) => ({
					recordId: record.id,
					attributes: [{ name: CONTRACT_SESSION_SEEN_ATTRIBUTE, value: 'yes' }],
				})),
				diagnostics: handed.map(({ record, ancestry }) =>
					createDiagnostic(CONTRACT_SESSION_DIAGNOSTICS, 'seen', {
						ref: { tagName: record.tagName, id: record.id },
						meta: { ancestry },
					}),
				),
			}
		},
	}
}

/** What every contract leg imports with: core's test config, the contract session, perf on. */
export function createContractRuntime(): StoreRuntime {
	const hooks: DialecteHooks<AnyDialecteConfig> = {
		createImportSession: createContractImportSession,
	}
	return {
		configs: { [TEST_CONFIG_KEY]: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
		defaultConfigKey: TEST_CONFIG_KEY,
		hooks,
		perf: true,
	}
}
