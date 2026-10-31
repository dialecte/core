import { ENGINE_SIGNAL } from '../engine.constants'

import type { Heartbeat } from './host.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * The engine's sign of life, posted on every client port it serves (a call may still sit in the
 * worker's queue behind the work, unknown to the engine) and to `tellControl`, the realm that runs it
 * (which waits on it for a new client's adoption): a beat at most every `intervalMs` while it works, a
 * `busy` before dialecte code that may run long with nothing to tell. Posted from the work itself, never
 * from a timer: a busy engine is never taken for a lost one.
 */
export function createHeartbeat(params: {
	intervalMs: number
	tellControl?: (message: { type: string }) => void
}): Heartbeat {
	const { intervalMs, tellControl } = params
	const ports = new Set<MessagePort>()
	let lastPostedAt = Number.NEGATIVE_INFINITY
	/** Opaque phases under way: while one runs, a beat says `busy` again (another call's work never clears it). */
	let opaque = 0

	function post(message: { type: string }): void {
		lastPostedAt = performance.now()
		tellControl?.(message)
		for (const port of ports) {
			try {
				port.postMessage(message)
			} catch {
				// a port gone: its client is told nothing more
			}
		}
	}

	return {
		add: function addPort(port) {
			ports.add(port)
			// a client adopted while dialecte code runs learns it at once: it may hear nothing else for long
			if (opaque > 0) port.postMessage({ type: ENGINE_SIGNAL.busy })
		},
		remove: function removePort(port) {
			ports.delete(port)
		},
		beat: function beat() {
			if (performance.now() - lastPostedAt < intervalMs) return
			post({ type: opaque > 0 ? ENGINE_SIGNAL.busy : ENGINE_SIGNAL.heartbeat })
		},
		busy: function busy() {
			opaque += 1
			post({ type: ENGINE_SIGNAL.busy })
		},
		idle: function idle() {
			opaque = Math.max(0, opaque - 1)
			post({ type: opaque > 0 ? ENGINE_SIGNAL.busy : ENGINE_SIGNAL.heartbeat })
		},
	}
}

/**
 * Work the engine cannot beat inside (one long opcode, a large answer cloned): every client is told the
 * engine is busy before it, beaten once it is done.
 */
export function runToldBusy<GenericResult>(params: {
	heartbeat: Heartbeat
	work: () => GenericResult
}): GenericResult {
	const { heartbeat, work } = params
	heartbeat.busy()
	try {
		return work()
	} finally {
		heartbeat.idle()
	}
}

/**
 * The dialecte's hooks with their opaque phases told: before the file-wide `beforeImport` and an
 * import session's `afterImport` - dialecte code that may run for seconds with no statement - every
 * client is told the engine is busy, then beaten once it is done.
 */
export function withOpaquePhases(params: {
	hooks: DialecteHooks<AnyDialecteConfig> | undefined
	heartbeat: Heartbeat
}): DialecteHooks<AnyDialecteConfig> | undefined {
	const { hooks, heartbeat } = params
	if (!hooks) return hooks
	const { beforeImport, createImportSession } = hooks
	return {
		...hooks,
		...(beforeImport && {
			beforeImport: function beforeImportTold(xml: string) {
				heartbeat.busy()
				try {
					return beforeImport(xml)
				} finally {
					heartbeat.idle()
				}
			},
		}),
		...(createImportSession && {
			createImportSession: function sessionTold(sessionParams) {
				const session = createImportSession(sessionParams)
				const { afterImport } = session
				if (!afterImport) return session
				return {
					...session,
					afterImport: async function afterImportTold() {
						heartbeat.busy()
						try {
							return await afterImport()
						} finally {
							heartbeat.idle()
						}
					},
				}
			},
		}),
	}
}
