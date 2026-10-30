import { throwOpenElsewhere, throwStoreClosed } from '../../store-errors'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { loadSqlite } from '../load-sqlite'
import { realmWasmUrl } from '../sqlite-wasm-url'

import type { EngineConnector, EngineLink } from '../../engine/engine-store.types'
import type { SqliteEngine } from '../engine/engine.types'
import type { InProcessConnectorParams, InProcessFile } from './in-process-link.types'

/** The in-memory project files of this realm, by name: one state per name, as the origin's files are. */
const FILES = new Map<string, InProcessFile>()
/** The connections open on each name: a destroy of the name is refused while one is. */
const CLIENTS = new Map<string, Set<EngineLink>>()

/**
 * The engine of a project run in the calling realm, on an in-memory file of its own (`memdb`): a
 * direct link, no worker. One engine per name, started by the first connection, closed with the last;
 * the file stays until the name is destroyed, so the next engine starts on what was written - its
 * start (layout check, unfinished imports removed) runs as after a reload.
 */
export function createInProcessConnector(params: InProcessConnectorParams): EngineConnector {
	return {
		connect: function connectInProcess() {
			return connectToEngine(params)
		},
		destroy: async function destroyInProcess(destroyParams) {
			const own = destroyParams?.own
			const clients = CLIENTS.get(params.name)
			const open = (clients?.size ?? 0) - (own !== undefined && clients?.has(own.link) ? 1 : 0)
			if (open > 0) throwOpenElsewhere({ storeName: params.name, connections: open })
			own?.letGo()
			closeFile({ name: params.name })
		},
	}
}

async function connectToEngine(params: InProcessConnectorParams): Promise<EngineLink> {
	const { name } = params
	const clients = CLIENTS.get(name) ?? new Set<EngineLink>()
	CLIENTS.set(name, clients)
	const clientId = crypto.randomUUID()
	let released = false
	const link: EngineLink = {
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
	const sqlite3 = await loadSqlite({ wasmUrl: realmWasmUrl() })
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

/**
 * The name's in-memory file can grow no more: its size limit set through a connection of its own (the
 * limit belongs to the file, every connection meets it; a limit below the file's size becomes its size,
 * so 0 caps it where it is, with no read of a file its engine holds). A test tool: what an origin out of
 * storage is to the engine.
 */
export async function fillInProcessFile(params: { name: string }): Promise<void> {
	const sqlite3 = await loadSqlite({ wasmUrl: realmWasmUrl() })
	const db = new sqlite3.oo1.DB(fileName(params), 'c')
	const limit = sqlite3.wasm.alloc(8)
	try {
		sqlite3.wasm.poke(limit, 0, 'i64')
		sqlite3.capi.sqlite3_file_control(
			db.pointer!,
			'main',
			sqlite3.capi.SQLITE_FCNTL_SIZE_LIMIT,
			limit,
		)
	} finally {
		sqlite3.wasm.dealloc(limit)
		db.close()
	}
}
