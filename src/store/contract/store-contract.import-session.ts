import {
	CONTRACT_HOLD_CHANNEL,
	CONTRACT_LONE_SURROGATE_TEXT,
	CONTRACT_SESSION_DIAGNOSTICS,
	CONTRACT_SESSION_FAIL_VALUE,
	CONTRACT_SESSION_FUNCTION_VALUE,
	CONTRACT_SESSION_HOLD_VALUE,
	CONTRACT_SESSION_LONE_SURROGATE_VALUE,
	CONTRACT_SESSION_SEEN_ATTRIBUTE,
	CONTRACT_SESSION_TAG,
	HOLD_ID_SEPARATOR,
} from './store-contract.constants'

import { onTestFinished } from 'vitest'

import { createDiagnostic } from '@/diagnostics'
import { TEST_DIALECTE_CONFIG } from '@/test/config'
import { TEST_CONFIG_KEY } from '@/test/constant'

import type { ContractHoldMessage, ContractImportHold } from './store-contract.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { AnyDialecteConfig, AnyRawRecord, DialecteHooks, ImportSession } from '@/types'

/**
 * Hold the next contract import whose file has a record of the session's tag with `bB` set to the
 * hold value: its session says it has `reached` the end of the parse, then waits until `release`.
 * Through a `BroadcastChannel`, so a store whose engine runs in a worker is held alike. `release` may
 * be called more than once.
 */
export function holdContractImport(): ContractImportHold {
	const id = crypto.randomUUID()
	const channel = holdChannel({ id })
	let markReached: () => void = markNothing
	const reached = new Promise<void>(function waitForReached(resolve) {
		markReached = resolve
	})
	let released = false
	// open until the case ends: a released hold answers a later import of the same file too
	onTestFinished(function closeHoldChannel() {
		channel.close()
	})
	channel.onmessage = function hearHold(event: MessageEvent<ContractHoldMessage>) {
		if (event.data.type !== 'reached') return
		markReached()
		// released for good: a later import of the same file reaching it goes on at once
		if (released) channel.postMessage({ type: 'release' } satisfies ContractHoldMessage)
	}
	return {
		value: `${CONTRACT_SESSION_HOLD_VALUE}${HOLD_ID_SEPARATOR}${id}`,
		reached,
		release: function release() {
			if (released) return
			released = true
			channel.postMessage({ type: 'release' } satisfies ContractHoldMessage)
		},
	}
}

/** Say the hold is reached, then wait for the case's release, in whatever realm the session runs. */
async function waitForRelease(params: { id: string }): Promise<void> {
	const channel = holdChannel(params)
	const released = new Promise<void>(function waitForRelease(resolve) {
		channel.onmessage = function hearRelease(event: MessageEvent<ContractHoldMessage>) {
			if (event.data.type === 'release') resolve()
		}
	})
	channel.postMessage({ type: 'reached' } satisfies ContractHoldMessage)
	await released
	channel.close()
}

/** The channel of one hold (its id: holds of test files running at once never meet); in node it never keeps the process alive. */
function holdChannel(params: { id: string }): BroadcastChannel {
	const channel = new BroadcastChannel(`${CONTRACT_HOLD_CHANNEL}${HOLD_ID_SEPARATOR}${params.id}`)
	;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
	return channel
}

function markNothing(): void {}

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

/** The id of the hold a record of the session's tag carries in `bB` (`hold:<id>`), if any. */
function holdIdOf(params: { handed: { record: AnyRawRecord }[] }): string | undefined {
	const prefix = `${CONTRACT_SESSION_HOLD_VALUE}${HOLD_ID_SEPARATOR}`
	for (const { record } of params.handed) {
		for (const attribute of record.attributes) {
			if (attribute.name === 'bB' && attribute.value.startsWith(prefix)) {
				return attribute.value.slice(prefix.length)
			}
		}
	}
	return undefined
}

/**
 * The import session every contract leg runs. Its behaviour is read from the file - a store behind a
 * worker cannot be handed a test's own hooks: it asks for the records of one tag only, says one
 * diagnostic per record it was handed (with the tag names of its open ancestors; a function or a lone
 * surrogate in its `meta` when the record's `bB` asks for one), marks each with an
 * attribute after the parse, fails when one of them has `bB` set to the fail value, and waits for the
 * case's release when one has it set to the hold value (`holdContractImport`, every file holding it
 * is held).
 */
function createContractImportSession(): ImportSession {
	const handed: { record: AnyRawRecord; ancestry: string[] }[] = []
	return {
		recordTagNames: [CONTRACT_SESSION_TAG],
		beforeImportRecord: ({ record, ancestry }) => {
			handed.push({ record, ancestry: ancestry.map((ancestor) => ancestor.tagName) })
		},
		afterImport: async () => {
			const holdId = holdIdOf({ handed })
			if (holdId) await waitForRelease({ id: holdId })
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
						meta: {
							ancestry,
							...(holdsValue({ record, value: CONTRACT_SESSION_FUNCTION_VALUE }) && {
								fix: sessionFix,
							}),
							...(holdsValue({ record, value: CONTRACT_SESSION_LONE_SURROGATE_VALUE }) && {
								note: CONTRACT_LONE_SURROGATE_TEXT,
							}),
						},
					}),
				),
			}
		},
	}
}

/** A record whose `bB` holds `value`: it asks for a diagnostic holding what that value names. */
function holdsValue(params: { record: AnyRawRecord; value: string }): boolean {
	const { record, value } = params
	return record.attributes.some((attribute) => attribute.name === 'bB' && attribute.value === value)
}

/** What a dialecte might wrongly put in a diagnostic: a function, which no store keeps nor any port carries. */
function sessionFix(): void {}

/** The hooks of the contract dialecte: the contract session, made fresh for each import. */
export function createContractHooks(): DialecteHooks<AnyDialecteConfig> {
	return { createImportSession: createContractImportSession }
}

/** What every contract leg imports with: core's test config, the contract session, perf on. */
export function createContractRuntime(): StoreRuntime {
	return {
		configs: { [TEST_CONFIG_KEY]: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
		defaultConfigKey: TEST_CONFIG_KEY,
		hooks: createContractHooks(),
		perf: true,
	}
}
