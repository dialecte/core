import { toThrownData } from '../served/wire/error-envelope'

import { createDialecteError } from '@/errors'

import type { EngineControlRequest } from '../served/engine.types'
import type { SqliteEngineSettings } from './runtime.types'
import type {
	AnswerEngineControl,
	ServeSqliteEngineParams,
	SqliteEngineChunk,
} from './serve-sqlite-engine.types'

/**
 * The light side of an engine worker, reaching nothing of the database: its listeners attached in the caller's turn
 * (a message reaching a worker before a listener exists is lost) and the engine's chunk asked for at once. Control
 * messages are handled one at a time in the order sent, each after the chunk: an open is done before a client is
 * adopted. A chunk that fails to load answers each control message `failed`, as data.
 */
export function runEngineControlLoop(
	params: ServeSqliteEngineParams & { loadEngine: () => Promise<SqliteEngineChunk> },
): void {
	const { dialectes, loadEngine } = params
	// an uncaught error of the dialecte's code (a hook's timer) is told on this worker's console only:
	// the engine goes on, and the realm that spawned it never takes it for the engine's end
	self.addEventListener('error', function keepUncaughtError(event: ErrorEvent) {
		console.error('Uncaught in the project engine:', event.error ?? event.message)
		event.preventDefault()
	})
	// asked for in this turn; a loader that throws here fails as one that rejects, the message listener still attached
	const answering = new Promise<SqliteEngineChunk>(function startLoading(resolve) {
		resolve(loadEngine())
	})
		.then(function startEngine(engine) {
			return engine.createSqliteEngineControl({ dialectes })
		})
		.catch(function failEveryMessage(thrown: unknown) {
			return answerFailed({ thrown })
		})
	let turn: Promise<void> = Promise.resolve()
	self.addEventListener('message', function takeControl(event: MessageEvent<unknown>) {
		const request = event.data
		// not a control message (no object, no request id): another listener's, or nothing
		if (!isControlRequest(request)) return
		turn = turn
			.then(function waitForEngine() {
				return answering
			})
			.then(function handleInTurn(answerControl) {
				return answerControl(request)
			})
			.catch(function keepServing(thrown: unknown) {
				console.error('The project engine could not answer a control message:', thrown)
			})
	})
}

/**
 * What answers a control message once the engine's chunk failed to load: `PROJECT_ENGINE_UNAVAILABLE` naming that
 * failure, whatever is asked (the realm ends a worker whose engine cannot open, as one whose script failed to load).
 */
function answerFailed(params: { thrown: unknown }): AnswerEngineControl {
	const failure = params.thrown instanceof Error ? params.thrown.message : String(params.thrown)
	const thrown = toThrownData({
		thrown: createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
			detail: `The engine worker could not load the engine's chunk, which serveSqliteEngine imports: ${failure}. A build or a precache list that leaves that chunk out cannot open any project`,
			meta: { failure },
		}),
	})
	return async function failControl({ requestId }) {
		self.postMessage({ type: 'failed', requestId, thrown })
	}
}

/** A control message of the engine's: an object with a type and a request id (a type guard: one value). */
function isControlRequest(request: unknown): request is EngineControlRequest<SqliteEngineSettings> {
	return (
		typeof request === 'object' &&
		request !== null &&
		typeof (request as { type?: unknown }).type === 'string' &&
		typeof (request as { requestId?: unknown }).requestId === 'number'
	)
}
