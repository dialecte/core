import type { LinkNotice } from '../engine-store.types'
import type {
	DistributiveOmit,
	EngineApi,
	EngineControlAnswer,
	EngineControlRequest,
} from '../engine.types'
import type { EngineEventSignal } from '../host/host.types'

/** The engine as one client reaches it through its port. */
export type EngineClient = {
	/** The engine's members, each call made for the port's own client. */
	api: EngineApi
	/** The engine's members, each call made for that connection of the page (several share one port through the hub). */
	connection: (params: { connectionId: string }) => EngineApi
	/** `listener` told each change the engine announces on this port; answers the unsubscribe. */
	onEvent: (listener: (signal: EngineEventSignal) => void) => () => void
	/** Refuse every call in flight `STORE_ENGINE_LOST` for that reason; the port stays. */
	lose: (params: { reason: EngineLostReason }) => void
	/** Release the port: the client reaches the engine no more; a call still waiting is refused `STORE_CLOSED`. */
	close: (params: { storeName: string }) => void
}

/**
 * Why an engine is lost: the view hosting it ended (its lock released), it sent nothing for too long
 * while a call waited (busy beyond reach, paused, frozen), or the hub dropped this view with the page
 * that bound it (it reaches the engine again once bound again).
 */
export type EngineLostReason = 'host-gone' | 'no-heartbeat' | 'realm-dropped'

/** A call waiting for the engine's answer: refused at once if the engine is lost. */
export type CallInFlight = {
	writeId: string | undefined
	/** An export's id: a lost export is told to stop (its result would reach no one). */
	exportId: string | undefined
	reject: (thrown: unknown) => void
	/** Refused lost already: its answer, if it ever comes, is dropped. */
	lost: boolean
}

export type WorkerConnectorParams<GenericSettings> = {
	/** The project's name. */
	name: string
	/**
	 * The dialecte of the project and the version the realm runs: with the name, what the project is - two
	 * dialectes' projects of one name never meet; an engine of another one is refused.
	 */
	dialecteId: string
	dialecteVersion: string
	/** The address of the dialecte's engine worker (its `?worker&url` export). */
	engineUrl: string
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
	/**
	 * The realm's budget for the project's engine (`ENGINE_OPEN_BUDGET_MS` when absent): how long its
	 * open may take in all (its lock and its own setup); how long the worker a destroy runs through has
	 * to delete the project, with the close budget besides to answer before it counts as deaf and is
	 * ended (`PROJECT_DESTROY_FAILED`); and how long the realm waits for the lock of a worker it ended
	 * deaf to close or to destroy before the next engine of the name starts, or the destroy runs.
	 */
	openBudgetMs?: number
	/**
	 * How long the realm waits for its engine's answer to an open (`ENGINE_OPEN_WINDOW_MS` when absent; never
	 * less than `openBudgetMs` and the close budget): past it the worker is ended and the open refused
	 * `PROJECT_ENGINE_UNAVAILABLE`.
	 */
	openWindowMs?: number
	/**
	 * How the engine and its clients tell a busy engine from a lost one (the defaults when absent): an engine
	 * silent for `heartbeatTimeoutMs` while a call waits, or while it adopts a new connection, is lost.
	 */
	liveness?: {
		heartbeatTimeoutMs?: number
		heartbeatIntervalMs?: number
	}
	/** What the engine's kind needs to open, handed to it as is (`EngineOpenParams.settings`). */
	settings: GenericSettings
}

/** A control request sent, waiting for its answer: the answer's type it expects, how it settles. */
export type PendingControlRequest = {
	expect: string
	resolve: (answer: EngineControlAnswer) => void
	reject: (thrown: unknown) => void
}

/** The engine worker a realm runs for one project in direct mode, and the connections it serves. */
export type RealmEngine = {
	worker: Worker
	/** Counts the engines of the name in this realm: a connection adopted by another one adopts again. */
	generation: number
	/** Settles once the engine opened (or failed to). */
	opened: Promise<void>
	control: EngineControl
	links: Set<WorkerLinkState>
	/** Set once the realm ends it, or sees it gone: it serves nothing more. */
	ended: boolean
	/** The page's request of the engine lock, granted once the worker no longer holds it (it is gone). */
	watch: { controller: AbortController; settled: Promise<void> } | undefined
	/** The id its project's file was created with, once it opened. */
	creationId: string | undefined
}

/**
 * A worker the realm ends: `ended` answers the work asked of it; `released` settles once the next engine of the
 * name may start (its lock let go, or waited for within the budget its answer gave it).
 */
export type EngineEnding = { ended: Promise<unknown>; released: Promise<void> }

/** A destroy through a fresh worker: `done` answers it, `released` as for any worker the realm ends. */
export type FreshWorkerDestroy = { done: Promise<void>; released: Promise<void> }

/** One connection of the realm to its engine worker: its client, and the engine that adopted it. */
export type WorkerLinkState = {
	clientId: string
	released: boolean
	/** What the connection's store listens with: each change of its engine, and each resync. */
	listeners: Set<(notice: LinkNotice) => void>
	/** Reach the project's engine now (an idle connection with a listener follows the next engine of its project). */
	follow: () => void
	/** Whether `follow` may start an engine: once after each call of the connection's own. */
	mayFollow: boolean
	/** The client the engine of that generation adopted for the connection (being adopted while pending). */
	adoption: { generation: number; client: Promise<EngineClient> } | undefined
	/**
	 * The creation id of the project the connection first reached: an engine started later for it (the one
	 * before ended) must open that project, else the connection is refused `PROJECT_DESTROYED_WHILE_AWAY`.
	 */
	creationId: string | undefined
	/** Its project destroyed while it was away (`PROJECT_DESTROYED_WHILE_AWAY`): every later call refused with it. */
	refusal: unknown
	/** Its release under way or done, once closed: a later close settles with it. */
	releasing: Promise<void> | undefined
}

/** The control messages of one engine worker, each answered by its request id. */
export type EngineControl = {
	request: <GenericType extends EngineControlAnswer['type']>(params: {
		message: DistributiveOmit<EngineControlRequest, 'requestId'>
		expect: GenericType
		transfer?: Transferable[]
	}) => Promise<Extract<EngineControlAnswer, { type: GenericType }>>
	/**
	 * The engine opened: from now on an uncaught error in its worker (a dialecte hook's timer) is no
	 * failure of the engine; before, it refuses every request waiting (`PROJECT_ENGINE_UNAVAILABLE`).
	 */
	opened: () => void
	/** The worker ended or lost: every request waiting, and every one made later, refused with `error`. */
	end: (params: { error: unknown }) => void
	/** Watch the engine's silence on this channel (`answeredOrSilent`), until stopped. */
	watchSilence: (params: { budgetMs: number }) => SilenceWatch
}

/** An engine's silence watched: `silent` settles once it has said nothing for the budget while not busy. */
export type SilenceWatch = { silent: Promise<void>; stop: () => void }

/** How a client watches its engine's silence while calls wait. */
export type HeartbeatWatch = {
	/** The silence counts from now (a call starts while none waited, the page resumed). */
	restart: () => void
	stop: () => void
}

/** The progress listeners of a client's calls in flight, each under the id its call sends the engine. */
export type ProgressListeners = {
	/** Keep the listener of a call; answers the id the call sends. */
	add: (params: { listener: (...progress: unknown[]) => unknown }) => number
	/** The call answered: its listener let go. */
	remove: (params: { progressId: number | undefined }) => void
	/** The engine lost: every listener let go (their calls are refused). */
	clear: () => void
	/** The client closed: nothing heard any more. */
	stop: () => void
}

/** The listeners of the changes an engine announces on a client's port. */
export type EventListeners = {
	/** Answers the unsubscribe. */
	add: (params: { listener: (signal: EngineEventSignal) => void }) => () => void
	stop: () => void
}
