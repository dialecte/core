import { ENGINE_SIGNAL } from '../engine.constants'
import { fromThrownData } from '../wire/error-envelope'
import { toWireArgs } from '../wire/wire-values'
import { ENGINE_WIRE_MEMBERS } from '../wire/wire.constants'
import { ENGINE_HEARTBEAT_TIMEOUT_MS, ENGINE_LOST_DETAILS } from './client.constants'
import { watchHeartbeat } from './heartbeat-watch'

import * as Comlink from 'comlink'

import { createDialecteError } from '@/errors'

import type { EngineApi } from '../engine.types'
import type { ProgressSignal } from '../host/host.types'
import type { EngineWire, WireMemberSpec } from '../wire/wire.types'
import type {
	CallInFlight,
	EngineClient,
	EngineLostReason,
	ProgressListeners,
} from './client.types'
import type { WriteOutcome } from '@/store/store.types'

/**
 * The engine as one client reaches it through its port: a plain object of the engine's members
 * (it answers no `then` and no symbol key, so it never looks like a promise), each call crossing as
 * the wire table says - its JSON values copied as plain data, its progress listener kept here under an
 * id (the engine posts each tick on this port: every tick is told before the answer), its answer an
 * envelope: a value, or what the engine threw, rebuilt. The calls in flight are known: once the engine is lost they are refused
 * `STORE_ENGINE_LOST` (a write with its `writeId`); a write refused so while its engine may still run
 * it is `running` for `getWriteOutcome` until its answer arrives.
 */
export function createEngineClient(params: {
	port: MessagePort
	heartbeatTimeoutMs?: number
}): EngineClient {
	const { port, heartbeatTimeoutMs = ENGINE_HEARTBEAT_TIMEOUT_MS } = params
	const remote = Comlink.wrap<EngineWire>(port)
	const inFlight = new Set<CallInFlight>()
	const listeners = createProgressListeners({ port })
	/** Writes refused lost whose engine may still apply them: their answer has not come. */
	const unanswered = new Set<string>()
	const watch = watchHeartbeat({
		source: port,
		timeoutMs: heartbeatTimeoutMs,
		waiting: function countWaiting() {
			return inFlight.size
		},
		lose: function loseSilentEngine() {
			lose({ reason: 'no-heartbeat' })
		},
	})

	function lose(params: { reason: EngineLostReason }): void {
		const { reason } = params
		for (const entry of inFlight) {
			refuseLost({ entry, reason, unanswered })
			// a silent engine may still run the export for minutes: stopped, unlike a write, whose outcome is asked later
			if (reason === 'no-heartbeat' && entry.exportId !== undefined) {
				abortLostExport({ exportId: entry.exportId })
			}
		}
		inFlight.clear()
		listeners.clear()
		// a gone engine took its queued writes with it: the next one answers for them
		if (reason === 'host-gone') unanswered.clear()
	}

	/** Told to the engine and forgotten: its answer, if it ever comes, changes nothing here. */
	function abortLostExport(params: { exportId: string }): void {
		const spec: WireMemberSpec = ENGINE_WIRE_MEMBERS.abortExport
		const wire = toWireArgs({ args: [params], places: spec.json ?? [] })
		remote
			.call({ member: 'abortExport', args: wire.args, standIns: wire.standIns })
			.catch(function abortNotSent() {
				// the port closed meanwhile: the engine is gone with its export
			})
	}

	function call(callParams: { member: keyof EngineApi; args: unknown[] }): Promise<unknown> {
		const { member, args } = callParams
		const spec: WireMemberSpec = ENGINE_WIRE_MEMBERS[member]
		const listener = spec.listener === undefined ? undefined : args[spec.listener]
		const given = spec.listener === undefined ? args : args.slice(0, spec.listener)
		const writeId = spec.identified ? (given[0] as { writeId?: string }).writeId : undefined
		const exportId = spec.abortable ? (given[0] as { exportId?: string }).exportId : undefined
		if (member === 'getWriteOutcome') {
			const asked = (given[0] as { writeId: string }).writeId
			if (unanswered.has(asked)) return Promise.resolve('running' satisfies WriteOutcome)
		}
		const wire = toWireArgs({ args: given, places: spec.json ?? [] })
		return new Promise(function callEngine(resolve, reject) {
			const progressId =
				typeof listener === 'function'
					? listeners.add({ listener: listener as (...progress: unknown[]) => unknown })
					: undefined
			const entry: CallInFlight = { writeId, exportId, reject, lost: false }
			// a call starting while none waited: the engine's silence counts from now
			if (inFlight.size === 0) watch.restart()
			inFlight.add(entry)
			remote.call({ member, args: wire.args, standIns: wire.standIns, progressId }).then(
				function answered(answer) {
					// every tick of the call came before its answer, on this port: the listener is done
					listeners.remove({ progressId })
					inFlight.delete(entry)
					if (writeId !== undefined) unanswered.delete(writeId)
					if (entry.lost) return
					if (answer.ok) resolve(answer.value)
					else reject(fromThrownData({ data: answer.thrown }))
				},
				function notSent(thrown: unknown) {
					listeners.remove({ progressId })
					inFlight.delete(entry)
					if (!entry.lost) reject(thrown)
				},
			)
		})
	}

	const api = Object.fromEntries(
		(Object.keys(ENGINE_WIRE_MEMBERS) as (keyof EngineApi)[]).map(function memberOf(member) {
			return [
				member,
				function callMember(...args: unknown[]) {
					return call({ member, args })
				},
			]
		}),
	) as unknown as EngineApi

	return {
		api,
		lose,
		/**
		 * The port released (the engine side forgets it when told the client is gone): a call still
		 * waiting is refused `STORE_CLOSED`, its answer never to come.
		 */
		close: function closeClient({ storeName }) {
			watch.stop()
			listeners.stop()
			for (const entry of inFlight) {
				entry.lost = true
				entry.reject(
					createDialecteError('STORE_CLOSED', {
						detail: `The connection to project "${storeName}" was released while a call waited`,
						meta: { storeName },
					}),
				)
			}
			inFlight.clear()
			port.close()
		},
	}
}

/**
 * The progress listeners of the calls in flight, each under the id its call sends: a tick the engine
 * posts on the port reaches its listener; a listener that throws is the caller's own affair.
 */
function createProgressListeners(params: { port: MessagePort }): ProgressListeners {
	const { port } = params
	const listeners = new Map<number, (...progress: unknown[]) => unknown>()
	let nextId = 0
	function hear(event: MessageEvent<ProgressSignal | undefined>): void {
		const signal = event.data
		if (signal?.type !== ENGINE_SIGNAL.progress) return
		try {
			const told = listeners.get(signal.progressId)?.(...signal.progress)
			// a listener answering a promise that rejects fails as one that throws: its call goes on
			Promise.resolve(told).catch(ignoreListenerFailure)
		} catch {
			// the caller's listener failed: its call goes on
		}
	}
	// beside Comlink's own listener: one port, the ticks heard in their order with the answers
	port.addEventListener('message', hear)
	return {
		add: function addListener({ listener }) {
			nextId += 1
			listeners.set(nextId, listener)
			return nextId
		},
		remove: function removeListener({ progressId }) {
			if (progressId !== undefined) listeners.delete(progressId)
		},
		clear: function clearListeners() {
			listeners.clear()
		},
		stop: function stopHearing() {
			listeners.clear()
			port.removeEventListener('message', hear)
		},
	}
}

function ignoreListenerFailure(): void {}

/** A call in flight refused: its engine is lost; a write's id kept to say it may still be running. */
function refuseLost(params: {
	entry: CallInFlight
	reason: EngineLostReason
	unanswered: Set<string>
}): void {
	const { entry, reason, unanswered } = params
	entry.lost = true
	if (entry.writeId !== undefined && reason === 'no-heartbeat') unanswered.add(entry.writeId)
	entry.reject(
		createDialecteError('STORE_ENGINE_LOST', {
			detail: ENGINE_LOST_DETAILS[reason],
			meta: { reason, ...(entry.writeId !== undefined && { writeId: entry.writeId }) },
		}),
	)
}
