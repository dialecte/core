import { throwStoreClosed } from '../../store-errors'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { loadSqlite } from '../load-sqlite'

import type { SqliteEngine } from '../engine/engine.types'
import type {
	InProcessConnectorParams,
	InProcessFile,
	SqliteEngineConnector,
	SqliteEngineLink,
} from './sqlite-store.types'

/** The in-memory project files of this realm, by name: one state per name, as the origin's files are. */
const FILES = new Map<string, InProcessFile>()
/** The connections open on each name; they outlive a destroy of the name and follow its new file. */
const CLIENTS = new Map<string, Set<SqliteEngineLink>>()

/**
 * The engine of a project run in the calling realm, on an in-memory file of its own (`memdb`): a
 * direct link, no worker. One engine per name, started by the first connection, closed with the last;
 * the file stays until the name is destroyed, so the next engine starts on what was written - its
 * start (layout check, unfinished imports removed) runs as after a reload.
 */
export function createInProcessConnector(params: InProcessConnectorParams): SqliteEngineConnector {
	return {
		connect: function connectInProcess() {
			return connectToEngine(params)
		},
		destroy: async function destroyInProcess() {
			closeFile({ name: params.name })
		},
	}
}

async function connectToEngine(params: InProcessConnectorParams): Promise<SqliteEngineLink> {
	const { name } = params
	const clients = CLIENTS.get(name) ?? new Set<SqliteEngineLink>()
	CLIENTS.set(name, clients)
	const clientId = crypto.randomUUID()
	let released = false
	const link: SqliteEngineLink = {
		engine: async function currentEngine() {
			// a released connection is not counted: it must not start an engine nobody would close
			if (released) throwStoreClosed({ storeName: name })
			const engine = await engineOf(params)
			return engine.clientView({ clientId })
		},
		close: function releaseEngine() {
			released = true
			if (!clients.delete(link) || clients.size > 0) return
			CLIENTS.delete(name)
			const file = FILES.get(name)
			file?.engine?.close()
			if (file) file.engine = undefined
		},
	}
	clients.add(link)
	return link
}

/** The engine running on the name's file, started first (on a new file when the name has none). */
async function engineOf(params: InProcessConnectorParams): Promise<SqliteEngine> {
	const { name, dialecteId, runtime, options } = params
	const sqlite3 = await loadSqlite()
	const file = FILES.get(name) ?? { keeper: new sqlite3.oo1.DB(fileName({ name }), 'c') }
	FILES.set(name, file)
	if (!file.engine) {
		// the engine owns its connection, closed by it when its start fails
		const db = new sqlite3.oo1.DB(fileName({ name }), 'c')
		file.engine = openSqliteEngine({ sqlite3, db, dialecteId, name, runtime, options })
	}
	return file.engine
}

/** The engine closed, then the keeper: the in-memory file goes with its last connection. */
function closeFile(params: { name: string }): void {
	const file = FILES.get(params.name)
	if (!file) return
	file.engine?.close()
	file.keeper.close()
	FILES.delete(params.name)
}

function fileName(params: { name: string }): string {
	return `file:/${encodeURIComponent(params.name)}?vfs=memdb`
}
