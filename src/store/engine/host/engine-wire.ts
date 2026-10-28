import { toThrownData } from '../wire/error-envelope'
import { fromWireArgs } from '../wire/wire-values'
import { ENGINE_WIRE_MEMBERS } from '../wire/wire.constants'
import { LARGE_ANSWER_RECORDS, LISTENER_FLUSH_BUDGET_MS } from './host.constants'

import * as Comlink from 'comlink'

import { createDialecteError } from '@/errors'
import { yieldToQueue } from '@/utils/yield-to-queue'

import type { EngineApi } from '../engine.types'
import type { EngineWire, WireAnswer, WireMemberSpec, WireRequest } from '../wire/wire.types'
import type { Heartbeat, ProgressRelay, ServedClient, StoreEvents } from './host.types'

/**
 * Serve one client's port: one member, `call`, every call of the engine through it - a member outside
 * the wire table refused, the values the client sent as stand-ins rebuilt, the listener told without
 * waiting (a dead port never holds the engine) and let go once the call settles, a success announced
 * on the project's channel, the answer an envelope: what the engine answered, or what it threw as data.
 */
export function serveClient(params: {
	port: MessagePort
	clientId: string
	view: EngineApi
	events: StoreEvents
	/** The engine's sign of life on its ports: told busy around an answer it cannot beat inside. */
	heartbeat: Heartbeat
}): ServedClient {
	const { port, clientId, view, events, heartbeat } = params
	let answering = 0
	const whenDrained: (() => void)[] = []
	const wire: EngineWire = {
		call: async function callMember(request, listener) {
			answering += 1
			try {
				const answer = await answerCall({ view, request, listener, clientId, events })
				if (isLargeAnswer({ answer })) {
					// Comlink clones it once this call resolves; the beat after it comes a message turn later
					heartbeat.busy()
					void yieldToQueue().then(heartbeat.idle)
				}
				return answer
			} finally {
				answering -= 1
				if (answering === 0) for (const drained of whenDrained.splice(0)) drained()
			}
		},
	}
	Comlink.expose(wire, port)
	return {
		port,
		drained: function untilDrained() {
			if (answering === 0) return Promise.resolve()
			return new Promise(function waitForAnswers(resolve) {
				whenDrained.push(resolve)
			})
		},
	}
}

async function answerCall(params: {
	view: EngineApi
	request: WireRequest
	listener: ((...progress: unknown[]) => void) | undefined
	clientId: string
	events: StoreEvents
}): Promise<WireAnswer> {
	const { view, request, listener, clientId, events } = params
	const relay = listener ? relayProgress({ listener }) : undefined
	try {
		const member = request.member
		if (!Object.hasOwn(ENGINE_WIRE_MEMBERS, member)) {
			throw createDialecteError('ASSERTION_FAILED', {
				detail: `"${member}" is no member of the engine`,
				meta: { member },
			})
		}
		const spec: WireMemberSpec = ENGINE_WIRE_MEMBERS[member as keyof EngineApi]
		const args = fromWireArgs({
			args: request.args,
			places: spec.json ?? [],
			standIns: request.standIns,
		})
		if (spec.listener !== undefined) {
			args.length = spec.listener
			args.push(relay?.tell)
		}
		const name = member as keyof EngineApi
		const run = view[name] as (...given: unknown[]) => Promise<unknown>
		const value = await run(...args)
		announceQuietly({ events, member: name, args, value, clientId })
		return { ok: true, value }
	} catch (thrown) {
		return { ok: false, thrown: toThrownData({ thrown }) }
	} finally {
		// the progress told last reaches the caller before its answer and before its proxy is let go: the
		// two travel on ports of their own, nothing else orders them
		await relay?.told()
		if (listener) releaseListener({ listener })
	}
}

/** A success told on the project's channel; a channel closed meanwhile (the engine closing) tells nothing. */
function announceQuietly(
	params: Parameters<StoreEvents['announce']>[0] & { events: StoreEvents },
): void {
	const { events, ...announced } = params
	try {
		events.announce(announced)
	} catch {
		// the channel closed with the engine: no realm needs the news of a call it no longer serves
	}
}

/** The caller's listener let go (its port closed on both sides); a port already gone is ignored. */
function releaseListener(params: { listener: unknown }): void {
	const remote = params.listener as { [Comlink.releaseProxy]?: () => void }
	try {
		remote[Comlink.releaseProxy]?.()
	} catch {
		// released already, or its port gone: nothing to let go
	}
}

/**
 * The caller's listener, told across the port and never awaited by the work: its failure (a closed port)
 * is dropped. `told` settles once the last tick has reached the caller, or `LISTENER_FLUSH_BUDGET_MS`
 * has passed (a listener on a page gone holds no answer longer).
 */
function relayProgress(params: { listener: (...progress: unknown[]) => unknown }): ProgressRelay {
	const { listener } = params
	let last: Promise<unknown> = Promise.resolve()
	return {
		tell: function tellCaller(...progress) {
			try {
				last = Promise.resolve(listener(...progress)).catch(ignoreListenerFailure)
			} catch {
				// a port that cannot post any more: the listener is gone, the engine goes on
			}
		},
		told: function lastTold() {
			let timer: ReturnType<typeof setTimeout> | undefined
			const budget = new Promise<void>(function waitBudget(resolve) {
				timer = setTimeout(resolve, LISTENER_FLUSH_BUDGET_MS)
			})
			return Promise.race([last.then(settleNothing), budget]).finally(function clearBudget() {
				clearTimeout(timer)
			})
		},
	}
}

function settleNothing(): void {}

function ignoreListenerFailure(): void {}

/** An answer holding a list of records long enough that cloning it onto the port takes long (one step). */
function isLargeAnswer(params: { answer: WireAnswer }): boolean {
	const { answer } = params
	return answer.ok && Array.isArray(answer.value) && answer.value.length >= LARGE_ANSWER_RECORDS
}
