import type { COUNTED_MEMBERS } from './transaction-read-cache.fixtures.constants'

/** One counted store member. */
export type CountedMember = (typeof COUNTED_MEMBERS)[number]

/** How many times each counted member was called. */
export type StoreCalls = Record<CountedMember, number>

/**
 * A counted member held once, when armed: the store answers as it is called, the hold tells it was `reached`, and the
 * answer is handed back only once `gate` settles (an answer in flight while other things happen).
 */
export type StoreHold = {
	member: CountedMember
	armed: boolean
	reached: () => void
	gate: Promise<void>
}
