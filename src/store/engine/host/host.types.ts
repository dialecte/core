import type { DistributiveOmit, EngineApi } from '../engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { ProjectChannelMessage } from '@/project/types'

/** The dialecte an engine serves, as the engine needs it: its identity and how to make its runtime. */
export type EngineDialecte = {
	id: string
	version: string
	/** The configs and a fresh set of the dialecte's hooks, measured when `perf`. */
	createRuntime: (params: { perf: boolean }) => StoreRuntime
}

/**
 * A change of the project as the engine posts it on every client's port: the project event, the connection whose
 * call made it, and that call's write id (a commit's, an import's) - a write its caller saw lost is its own no more.
 */
export type EngineEventSignal = {
	type: 'event'
	message: ProjectChannelMessage
	connectionId: string
	writeId?: string
}

/**
 * How each member's success is told (its timestamp added when posted): nothing for a member left out, nor when its
 * answer says it changed nothing (`false`).
 */
export type StoreEventOf = Partial<
	Record<
		keyof EngineApi,
		(params: {
			args: unknown[]
			value: unknown
		}) => DistributiveOmit<ProjectChannelMessage, 'timestamp'> | undefined
	>
>

/** A member's success as the engine tells it: the call, and the connection it was made for. */
export type AnnouncedCall = {
	member: keyof EngineApi
	args: unknown[]
	value: unknown
	connectionId: string
}

/** How the engine tells its clients each change. */
export type StoreEvents = {
	announce: (params: AnnouncedCall) => void
	close: () => void
}

/** The engine's sign of life on the ports it serves. */
export type Heartbeat = {
	add: (port: MessagePort) => void
	remove: (port: MessagePort) => void
	/** A beat, unless one was posted less than the interval ago. */
	beat: () => void
	/** Opaque dialecte code begins: clients wait for the engine's next message, however long. */
	busy: () => void
	/** That opaque code ended: a beat now (a `busy` again while another opaque phase still runs). */
	idle: () => void
}

/** A client port the engine serves, and when every call it was asked has been answered. */
export type ServedClient = {
	port: MessagePort
	drained: () => Promise<void>
}

/** A tick of a call's progress, posted on the client's port under the call's progress id. */
export type ProgressSignal = {
	type: 'progress'
	progressId: number
	progress: unknown[]
}
