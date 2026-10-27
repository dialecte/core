import type { ImportQueue, ImportQueueEntry } from './engine.types'

/**
 * The imports of an engine: one runs at a time (an import changes the connection's pragmas), the
 * others wait their turn in the order they came. Each is owned by the client that asked for it.
 */
export function createImportQueue(): ImportQueue {
	/** The running import first, then the waiting ones in order. */
	const entries: ImportQueueEntry[] = []
	return {
		run: function run(params) {
			return runInTurn({ entries, ...params })
		},
		abort: function abort({ writeId }) {
			abortWhere({ entries, matches: (entry) => entry.writeId === writeId })
		},
		abortOwnedBy: function abortOwnedBy({ clientId }) {
			abortWhere({ entries, matches: (entry) => entry.clientId === clientId })
		},
		abortAll: function abortAll() {
			abortWhere({ entries, matches: () => true })
		},
		waits: function waits({ writeId }) {
			return entries.some((entry) => entry.writeId === writeId && !entry.running)
		},
	}
}

/** Queued before the first await: an abort asked right after the call finds the import. */
async function runInTurn<GenericResult>(params: {
	entries: ImportQueueEntry[]
	writeId: string
	clientId: string
	work: (signal: AbortSignal) => Promise<GenericResult>
}): Promise<GenericResult> {
	const { entries, writeId, clientId, work } = params
	const turn = Promise.withResolvers<void>()
	const entry: ImportQueueEntry = {
		writeId,
		clientId,
		controller: new AbortController(),
		hasTurn: false,
		running: false,
		start: turn.resolve,
	}
	entries.push(entry)
	if (entries.length === 1) giveTurn({ entry })
	try {
		await turn.promise
		// from here the work runs on without a pause until its first write: it is running
		entry.running = true
		return await work(entry.controller.signal)
	} finally {
		leaveQueue({ entries, entry })
	}
}

/**
 * Abort the matching imports: a running one at its next check; a waiting one leaves the queue at once
 * and gets its turn right away, so its work refuses it before it starts (`IMPORT_ABORTED`, nothing
 * registered) without waiting for the import that runs.
 */
function abortWhere(params: {
	entries: ImportQueueEntry[]
	matches: (entry: ImportQueueEntry) => boolean
}): void {
	const { entries, matches } = params
	for (const entry of entries.filter(matches)) {
		entry.controller.abort()
		if (entry.hasTurn) continue
		entries.splice(entries.indexOf(entry), 1)
		giveTurn({ entry })
	}
}

function giveTurn(params: { entry: ImportQueueEntry }): void {
	const { entry } = params
	entry.hasTurn = true
	entry.start()
}

/** The import done (or gone): out of the queue; the next waiting one gets its turn. */
function leaveQueue(params: { entries: ImportQueueEntry[]; entry: ImportQueueEntry }): void {
	const { entries, entry } = params
	const index = entries.indexOf(entry)
	if (index === -1) return
	entries.splice(index, 1)
	const next = entries[0]
	if (next && !next.hasTurn) giveTurn({ entry: next })
}
