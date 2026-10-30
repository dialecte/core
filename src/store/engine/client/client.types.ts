import type {
	DistributiveOmit,
	EngineApi,
	EngineControlAnswer,
	EngineControlRequest,
} from '../engine.types'

/** The engine as one client reaches it through its port. */
export type EngineClient = {
	api: EngineApi
	/** Refuse every call in flight `STORE_ENGINE_LOST` for that reason; the port stays. */
	lose: (params: { reason: EngineLostReason }) => void
	/** Release the port: the client reaches the engine no more; a call still waiting is refused `STORE_CLOSED`. */
	close: (params: { storeName: string }) => void
}

/**
 * Why an engine is lost: the view hosting it ended (its lock released), or it sent nothing for too
 * long while a call waited (busy beyond reach, paused, frozen).
 */
export type EngineLostReason = 'host-gone' | 'no-heartbeat'

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
	/** The address of the dialecte's engine worker (its `?worker&url` export). */
	engineUrl: string
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
	/**
	 * The realm's budget for the project's engine (`ENGINE_OPEN_BUDGET_MS` when absent): how long its
	 * open may take in all (its lock and its own setup); how long a running engine has to destroy the
	 * project, and a fresh worker too, each with the close budget besides to answer before it counts as
	 * deaf and is ended; and how long the realm waits for the lock of an engine it ended deaf (to close or
	 * to destroy) before the next engine of the name starts, or the destroy is refused
	 * `PROJECT_ENGINE_BUSY`.
	 */
	openBudgetMs?: number
	/** How the engine and its clients tell a busy engine from a lost one (the defaults when absent). */
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
}

/** One connection of the realm to its engine worker: its client, and the engine that adopted it. */
export type WorkerLinkState = {
	clientId: string
	released: boolean
	/** The client the engine of that generation adopted for the connection (being adopted while pending). */
	adoption: { generation: number; client: Promise<EngineClient> } | undefined
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
}

/** How a client watches its engine's silence while calls wait. */
export type HeartbeatWatch = {
	/** The silence counts from now (a call starts while none waited, the page resumed). */
	restart: () => void
	stop: () => void
}

/** A page's request of an engine lock its engine holds: granted once the engine let it go. */
export type LockLetGoWatch = {
	granted: Promise<void>
	/** Settles once the request was let go, or withdrawn. */
	settled: Promise<void>
	/** Withdraw the request, if not granted yet. */
	stop: () => void
}
