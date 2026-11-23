import type { GatedMember, HeldCall, StoreGate } from './read-model-harness.types'
import type { GateState } from './read-model-internal.types'
import type { Store, StoreNotice } from '@/store/store.types'

/**
 * A store behind a gate: every member answers as `store` does, counted; a member can be held so its next call waits
 * (a read in flight while a change lands), and the notices the store tells can be held (a late notice).
 *
 * @intent hold a store read in flight in a test, delay a store's change notices, count store calls of a project
 */
export function gateStore(params: { store: Store }): StoreGate {
	const state: GateState = {
		store: params.store,
		counts: new Map(),
		holds: new Map(),
		answerHolds: new Map(),
		released: [],
		notices: { held: false, waiting: [], reached: noOp },
	}
	const gated = new Proxy(params.store, {
		// the Proxy API hands the trap its target, the property and the receiver as it calls it
		get: function readThroughGate(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver)
			if (typeof value !== 'function' || typeof property !== 'string') return value
			if (property === 'subscribe') {
				return gatedSubscribe({ state, subscribe: value as NonNullable<Store['subscribe']> })
			}
			return gatedMember({
				state,
				member: property as GatedMember,
				call: value as (...args: unknown[]) => unknown,
			})
		},
	})
	return {
		store: gated,
		counts: state.counts,
		hold: function hold(holdParams) {
			return holdMember({ state, member: holdParams.member })
		},
		holdAnswer: function holdAnswer(holdParams) {
			return holdMember({ state, member: holdParams.member, holds: state.answerHolds })
		},
		holdNotices: function holdNotices() {
			state.notices.held = true
			const reached = new Promise<void>(function onFirstHeld(resolve) {
				state.notices.reached = resolve
			})
			return { reached }
		},
		releaseNotices: function releaseNotices() {
			releaseHeldNotices({ state })
		},
		releaseAll: function releaseAll() {
			state.holds.clear()
			state.answerHolds.clear()
			for (const release of state.released.splice(0)) release()
			releaseHeldNotices({ state })
		},
	}
}

/** A hold of the next call of `member`: reached when the call arrives, sent on when released. */
// dialecte-allow argument-mutation: the gate's own state, filled by the holds set on it
function holdMember(params: {
	state: GateState
	member: GatedMember
	holds?: GateState['holds']
}): HeldCall {
	let arrive: () => void = noOp
	let release: () => void = noOp
	const reached = new Promise<void>(function onArrival(resolve) {
		arrive = resolve
	})
	const opened = new Promise<void>(function onRelease(resolve) {
		release = resolve
	})
	const holds = params.holds ?? params.state.holds
	const queue = holds.get(params.member) ?? []
	queue.push({ arrive, opened })
	holds.set(params.member, queue)
	params.state.released.push(release)
	return { reached, release }
}

/** The next hold of `member`, if one waits: the call meets it and waits until it is released. */
function nextHold(params: {
	state: GateState
	member: GatedMember
	holds?: GateState['holds']
}): Promise<void> | undefined {
	const waiting = (params.holds ?? params.state.holds).get(params.member)?.shift()
	if (!waiting) return undefined
	waiting.arrive()
	return waiting.opened
}

/** The store's `subscribe`, its listener told through the gate (held while notices are held). */
// dialecte-allow argument-mutation: the gate's own notices held, told when released
function gatedSubscribe(params: { state: GateState; subscribe: NonNullable<Store['subscribe']> }) {
	const { state, subscribe } = params
	return function subscribeThroughGate(listener: (notice: StoreNotice) => void): () => void {
		state.counts.set('subscribe', (state.counts.get('subscribe') ?? 0) + 1)
		return subscribe.call(state.store, function tellThroughGate(notice: StoreNotice) {
			if (!state.notices.held) {
				listener(notice)
				return
			}
			state.notices.waiting.push(function tellLate() {
				listener(notice)
			})
			state.notices.reached()
		})
	}
}

/** A member of the store, counted, waiting at its hold first when one is set. */
// dialecte-allow argument-mutation: the gate's own call counts
function gatedMember(params: {
	state: GateState
	member: GatedMember
	call: (...args: unknown[]) => unknown
}) {
	const { state, member, call } = params
	return function callThroughGate(...args: unknown[]): unknown {
		state.counts.set(member, (state.counts.get(member) ?? 0) + 1)
		const opened = nextHold({ state, member })
		const answered = opened
			? opened.then(function callOnceReleased() {
					return call.apply(state.store, args)
				})
			: call.apply(state.store, args)
		if (!state.answerHolds.get(member)?.length) return answered
		return holdTheAnswer({ state, member, answered: answered as Promise<unknown> })
	}
}

/** Stops holding notices and tells the held ones, in the order the store told them. */
function releaseHeldNotices(params: { state: GateState }): void {
	const { notices } = params.state
	notices.held = false
	for (const tell of notices.waiting.splice(0)) tell()
}

/** The store's answer, given back once the answer hold of `member` is released (it is reached when the store answered). */
async function holdTheAnswer(params: {
	state: GateState
	member: GatedMember
	answered: Promise<unknown>
}): Promise<unknown> {
	const { state, member, answered } = params
	const answer = await answered
	const opened = nextHold({ state, member, holds: state.answerHolds })
	if (opened) await opened
	return answer
}

/** Nothing, until a promise hands its resolver over. */
function noOp(): void {}
