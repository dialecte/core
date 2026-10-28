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

/** A store event as the engine posts it: a project event, tagged with the client whose call made it. */
export type StoreEvent = ProjectChannelMessage & { clientId: string }

/** How each member's success is told on the project's channel (its timestamp added when posted). */
export type StoreEventOf = Partial<
	Record<
		keyof EngineApi,
		(params: {
			args: unknown[]
			value: unknown
		}) => DistributiveOmit<ProjectChannelMessage, 'timestamp'>
	>
>

/** The project's channel the engine announces on. */
export type StoreEvents = {
	announce: (params: {
		member: keyof EngineApi
		args: unknown[]
		value: unknown
		clientId: string
	}) => void
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
