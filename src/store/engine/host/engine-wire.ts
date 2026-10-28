import { toThrownData } from '../wire/error-envelope'
import { fromWireArgs } from '../wire/wire-values'
import { ENGINE_WIRE_MEMBERS } from '../wire/wire.constants'

import * as Comlink from 'comlink'

import { createDialecteError } from '@/errors'

import type { EngineApi } from '../engine.types'
import type { EngineWire, WireAnswer, WireMemberSpec, WireRequest } from '../wire/wire.types'
import type { ServedClient, StoreEvents } from './host.types'

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
}): ServedClient {
	const { port, clientId, view, events } = params
	let answering = 0
	const whenDrained: (() => void)[] = []
	const wire: EngineWire = {
		call: async function callMember(request, listener) {
			answering += 1
			try {
				return await answerCall({ view, request, listener, clientId, events })
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
			args.push(listener ? tellWithoutWaiting({ listener }) : undefined)
		}
		const name = member as keyof EngineApi
		const run = view[name] as (...given: unknown[]) => Promise<unknown>
		const value = await run(...args)
		announceQuietly({ events, member: name, args, value, clientId })
		return { ok: true, value }
	} catch (thrown) {
		return { ok: false, thrown: toThrownData({ thrown }) }
	} finally {
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

/** The caller's listener, told across the port and never awaited: its failure (a closed port) is dropped. */
function tellWithoutWaiting(params: {
	listener: (...progress: unknown[]) => unknown
}): (...progress: unknown[]) => void {
	const { listener } = params
	return function tellCaller(...progress) {
		try {
			Promise.resolve(listener(...progress)).catch(ignoreListenerFailure)
		} catch {
			// a port that cannot post any more: the listener is gone, the engine goes on
		}
	}
}

function ignoreListenerFailure(): void {}
