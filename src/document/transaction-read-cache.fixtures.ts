import { inMemoryTestStore, READ_SCOPE_DIALECTE } from './query/read-scope/read-scope.fixtures'

import { createTestHelpers } from '@/test/create-test-helpers'

import type { Store } from '@/store'

/** The store members a transaction read is counted by. */
export const COUNTED_MEMBERS = ['getByAttributes', 'getByTagNameInDocument', 'count'] as const

/**
 * A counted member held once, when armed: the store answers as it is called, the hold tells it was `reached`, and the
 * answer is handed back only once `gate` settles (an answer in flight while other things happen).
 */
export type StoreHold = {
	member: (typeof COUNTED_MEMBERS)[number]
	armed: boolean
	reached: () => void
	gate: Promise<void>
}

/** A hold of `member`, armed, with the promise that it was reached and the release of its gate. */
export function holdOf(member: StoreHold['member']): {
	hold: StoreHold
	reached: Promise<void>
	release: () => void
} {
	let release: () => void = () => {}
	let tellReached: () => void = () => {}
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const reached = new Promise<void>((resolve) => {
		tellReached = resolve
	})
	return { hold: { member, armed: false, reached: tellReached, gate }, reached, release }
}

/** How many times each counted member was called. */
export type StoreCalls = Record<(typeof COUNTED_MEMBERS)[number], number>

const helpers = createTestHelpers({ dialecte: READ_SCOPE_DIALECTE })

/** The store, its counted members noted in `calls` (other members answer as the store does). */
export function countingStore(params: {
	store: Store
	calls: StoreCalls
	hold?: StoreHold
	documentCount?: number
}): Store {
	const { store, calls, hold, documentCount } = params
	return new Proxy(store, {
		get: function memberOfStore(target, property) {
			const member: unknown = Reflect.get(target, property, target)
			if (typeof member !== 'function') return member
			const name = String(property) as (typeof COUNTED_MEMBERS)[number]
			if (!COUNTED_MEMBERS.includes(name)) return member.bind(target)
			return async function countedMember(...args: unknown[]) {
				calls[name]++
				if (name === 'count' && documentCount !== undefined) return documentCount
				// the store reads as it is called; a held answer is only handed back once the gate settles
				const answer = (member as (...args: unknown[]) => unknown).apply(target, args)
				if (hold?.armed && hold.member === name) {
					hold.armed = false
					hold.reached()
					await hold.gate
				}
				return answer
			}
		},
	})
}

/** No call counted yet. */
export function noCalls(): StoreCalls {
	return { getByAttributes: 0, getByTagNameInDocument: 0, count: 0 }
}

/** The calls made since `before`. */
export function callsSince(params: { calls: StoreCalls; before: StoreCalls }): StoreCalls {
	const { calls, before } = params
	return {
		getByAttributes: calls.getByAttributes - before.getByAttributes,
		getByTagNameInDocument: calls.getByTagNameInDocument - before.getByTagNameInDocument,
		count: calls.count - before.count,
	}
}

/**
 * A project of `sourceXml` over an in-memory store under `name`, every counted store call noted from now on. Not
 * `openScopedProject`: that one logs versioned reads of a fixed two-record document; this one counts plain store calls.
 */
export async function openCountedProject(params: {
	sourceXml: string
	name?: string
	hold?: StoreHold
	documentCount?: number
}) {
	const name = params.name ?? crypto.randomUUID()
	const calls = noCalls()
	const store = countingStore({
		store: inMemoryTestStore({ name }),
		calls,
		hold: params.hold,
		documentCount: params.documentCount,
	})
	const { project, source } = await helpers.createTestProject({
		sourceXml: params.sourceXml,
		storage: { type: 'custom', store },
	})
	Object.assign(calls, noCalls())
	return { project, document: source.document, calls, name }
}
