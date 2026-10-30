import { ENGINE_SIGNAL } from '../engine.constants'
import { toThrownData } from '../wire/error-envelope'
import { fromWireArgs } from '../wire/wire-values'
import { ENGINE_WIRE_MEMBERS } from '../wire/wire.constants'
import { LARGE_ANSWER_RECORDS } from './host.constants'

import * as Comlink from 'comlink'

import { createDialecteError } from '@/errors'
import { yieldToQueue } from '@/utils/yield-to-queue'

import type { EngineApi } from '../engine.types'
import type { EngineWire, WireAnswer, WireMemberSpec, WireRequest } from '../wire/wire.types'
import type { Heartbeat, ProgressSignal, ServedClient, StoreEvents } from './host.types'

/**
 * Serve one client's port: one member, `call`, every call of the engine through it - a member outside
 * the wire table refused, the values the client sent as stand-ins rebuilt, each progress tick posted on
 * the same port without waiting (a dead port never holds the engine; one port, so every tick reaches
 * the caller before the answer), a success announced on the project's channel, the answer an envelope:
 * what the engine answered, or what it threw as data.
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
		call: async function callMember(request) {
			answering += 1
			try {
				const answer = await answerCall({ view, request, port, clientId, events })
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
	Comlink.expose(wire, refusingEndpoint({ port }))
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
	port: MessagePort
	clientId: string
	events: StoreEvents
}): Promise<WireAnswer> {
	const { view, request, port, clientId, events } = params
	const { progressId } = request
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
			args.push(progressId === undefined ? undefined : tellProgress({ port, progressId }))
		}
		const name = member as keyof EngineApi
		const run = view[name] as (...given: unknown[]) => Promise<unknown>
		const value = await run(...args)
		announceQuietly({ events, member: name, args, value, clientId })
		return { ok: true, value }
	} catch (thrown) {
		return { ok: false, thrown: toThrownData({ thrown }) }
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

/**
 * The call's listener as the engine calls it: each tick posted on the client's port under the call's
 * progress id, never awaited; a tick the port cannot clone, or a port closed, is dropped - the engine
 * goes on.
 */
function tellProgress(params: {
	port: MessagePort
	progressId: number
}): (...progress: unknown[]) => void {
	const { port, progressId } = params
	return function tellCaller(...progress: unknown[]) {
		const signal: ProgressSignal = { type: ENGINE_SIGNAL.progress, progressId, progress }
		try {
			port.postMessage(signal)
		} catch {
			// not clonable, or the port gone: the caller misses a tick, the engine goes on
		}
	}
}

/** An answer holding a list of records long enough that cloning it onto the port takes long (one step). */
function isLargeAnswer(params: { answer: WireAnswer }): boolean {
	const { answer } = params
	return answer.ok && Array.isArray(answer.value) && answer.value.length >= LARGE_ANSWER_RECORDS
}

/**
 * The port as Comlink answers on it: an answer the port refuses to clone is answered as the refusal,
 * as data - never the value made clonable, which only a call through a port would see (what a store
 * answers is plain data on every leg; what an error carries is made clonable by its envelope).
 */
function refusingEndpoint(params: { port: MessagePort }): Comlink.Endpoint {
	const { port } = params
	return {
		postMessage: function postClonable(message: unknown, transfer?: Transferable[]) {
			try {
				port.postMessage(message, transfer ?? [])
			} catch (thrown) {
				if (!isDataCloneError({ thrown })) throw thrown
				postRefusal({ port, message, thrown })
			}
		},
		addEventListener: function addListener(...args: Parameters<MessagePort['addEventListener']>) {
			port.addEventListener(...args)
		},
		removeEventListener: function removeListener(
			...args: Parameters<MessagePort['removeEventListener']>
		) {
			port.removeEventListener(...args)
		},
		start: function startPort() {
			port.start()
		},
	}
}

/** Comlink's answer message, its value (an envelope) replaced by the port's refusal. */
function postRefusal(params: { port: MessagePort; message: unknown; thrown: unknown }): void {
	const { port, message, thrown } = params
	port.postMessage({
		...(message as object),
		value: { ok: false, thrown: toThrownData({ thrown }) },
	})
}

function isDataCloneError(params: { thrown: unknown }): boolean {
	const { thrown } = params
	return thrown instanceof DOMException && thrown.name === 'DataCloneError'
}
