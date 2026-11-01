import { refuseOtherCreation } from '../../engine/creation-refusal'
import { storeEventOf } from '../../engine/host/store-events'
import { projectKeyOf } from '../../engine/project-key'
import { refuseUnnamableProject } from '../../project-name'
import { throwOpenElsewhere, throwStoreClosed } from '../../store-errors'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { loadSqlite } from '../load-sqlite'
import { realmWasmUrl } from '../sqlite-wasm-url'

import { tellListeners } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'

import type { EngineConnector, EngineLink, LinkNotice } from '../../engine/engine-store.types'
import type { EngineApi } from '../../engine/engine.types'
import type { AnnouncedCall } from '../../engine/host/host.types'
import type { SqliteEngine } from '../engine/engine.types'
import type { InProcessConnectorParams, InProcessFile } from './in-process-link.types'

/**
 * The in-memory project files of this realm, by project key (`projectKeyOf`: dialecte and name): one state
 * per project, as the origin's files are.
 */
const FILES = new Map<string, InProcessFile>()
/** The connections open on each project, by its key: a destroy of it is refused while one is. */
const CLIENTS = new Map<string, Set<EngineLink>>()
/** What each connection's store listens with: every change of its project, and each resync. */
const LISTENERS = new WeakMap<EngineLink, Set<(notice: LinkNotice) => void>>()

/**
 * The engine of a project run in the calling realm, on an in-memory file of its own (`memdb`): a
 * direct link, no worker. One engine per name, started by the first connection, closed with the last;
 * the file stays until the name is destroyed, so the next engine starts on what was written - its
 * start (layout check, unfinished imports removed) runs as after a reload.
 */
export function createInProcessConnector(params: InProcessConnectorParams): EngineConnector {
	refuseUnnamableProject({ project: params.name, dialecteId: params.dialecteId })
	return {
		connect: function connectInProcess() {
			return connectToEngine(params)
		},
		destroy: async function destroyInProcess(destroyParams) {
			const own = destroyParams?.own
			const key = keyOf(params)
			const clients = CLIENTS.get(key)
			const open = (clients?.size ?? 0) - (own !== undefined && clients?.has(own.link) ? 1 : 0)
			if (open > 0) throwOpenElsewhere({ storeName: params.name, connections: open })
			void own?.letGo()
			closeFile({ key })
		},
	}
}

async function connectToEngine(params: InProcessConnectorParams): Promise<EngineLink> {
	const { name } = params
	const key = keyOf(params)
	const clients = CLIENTS.get(key) ?? new Set<EngineLink>()
	CLIENTS.set(key, clients)
	const clientId = crypto.randomUUID()
	let released = false
	/**
	 * The creation id of the project this connection first reached: a later engine must run that project. No
	 * in-process connection is away while its project is destroyed (a destroy waits for every connection to close):
	 * kept so that every connection checks its project the same way.
	 */
	let creationId: string | undefined
	/** The engine this connection last reached: another one since is announced with a resync. */
	let reached: SqliteEngine | undefined
	const listeners = new Set<(notice: LinkNotice) => void>()
	const link: EngineLink = {
		engine: async function currentEngine() {
			// a released connection is not counted: it must not start an engine nobody would close
			if (released) throwStoreClosed({ storeName: name })
			const engine = await engineOf({ ...params, expectedCreationId: creationId })
			refuseOtherCreation({
				project: name,
				expectedCreationId: creationId,
				creationId: engine.creationId,
			})
			creationId = engine.creationId
			if (reached !== undefined && reached !== engine)
				tellLink({ link, notice: { type: 'resync' } })
			reached = engine
			return announcingView({
				view: engine.clientView({ clientId }),
				announce: function announceToProject(call) {
					const signal = storeEventOf({ ...call, connectionId: clientId })
					if (!signal) return
					for (const other of CLIENTS.get(key) ?? []) {
						tellLink({ link: other, notice: { type: 'event', signal } })
					}
				},
			})
		},
		connectionId: clientId,
		onNotice: function listen(listener) {
			if (released) return stopNothing
			listeners.add(listener)
			return function stopListening() {
				listeners.delete(listener)
			}
		},
		close: async function releaseEngine() {
			released = true
			listeners.clear()
			if (!clients.delete(link) || clients.size > 0) return
			CLIENTS.delete(key)
			const file = FILES.get(key)
			file?.engine?.close()
			if (file) file.engine = undefined
		},
	}
	LISTENERS.set(link, listeners)
	clients.add(link)
	return link
}

/**
 * The engine's members as a connection calls them in the realm: each success announced (`announce`) before the call
 * resolves, as an engine in a worker tells it on every port before the answer.
 */
function announcingView(params: {
	view: EngineApi
	announce: (call: Omit<AnnouncedCall, 'connectionId'>) => void
}): EngineApi {
	const { view, announce } = params
	return Object.fromEntries(
		(Object.keys(view) as (keyof EngineApi)[]).map(function announcingMember(member) {
			const run = view[member] as (...args: unknown[]) => Promise<unknown>
			return [
				member,
				async function callAndAnnounce(...args: unknown[]) {
					const value = await run(...args)
					announce({ member, args, value })
					return value
				},
			]
		}),
	) as unknown as EngineApi
}

/** A connection's store told `notice`; a listener that throws stops no other. */
function tellLink(params: { link: EngineLink; notice: LinkNotice }): void {
	tellListeners({
		listeners: LISTENERS.get(params.link) ?? [],
		value: params.notice,
		of: TOLD_OF.engineChanges,
	})
}

/** The unsubscribe of a listener never added: a released connection hears nothing. */
function stopNothing(): void {}

/**
 * The engine running on the project's file, started first (on a new file when the project has none - unless
 * the connection expects its project there: destroyed meanwhile, nothing made in its place).
 */
async function engineOf(
	params: InProcessConnectorParams & { expectedCreationId: string | undefined },
): Promise<SqliteEngine> {
	const { name, dialecteId, runtime, options, expectedCreationId } = params
	const key = keyOf(params)
	const sqlite3 = await loadSqlite({ wasmUrl: realmWasmUrl() })
	const existing = FILES.get(key)
	if (!existing) refuseOtherCreation({ project: name, expectedCreationId, creationId: undefined })
	const file = existing ?? { keeper: new sqlite3.oo1.DB(fileName({ key }), 'c') }
	FILES.set(key, file)
	if (!file.engine) {
		// the engine owns its connection, closed by it when its start fails
		const db = new sqlite3.oo1.DB(fileName({ key }), 'c')
		const engine = openSqliteEngine({
			sqlite3,
			db,
			dialecteId,
			expectedCreationId,
			name,
			runtime,
			options,
			// broken (closed by then): the next call starts an engine afresh on the file
			onBroken: function startAfresh() {
				if (file.engine === engine) file.engine = undefined
			},
		})
		file.engine = engine
	}
	return file.engine
}

/** The engine closed, then the keeper: the in-memory file goes with its last connection. */
function closeFile(params: { key: string }): void {
	const file = FILES.get(params.key)
	if (!file) return
	file.engine?.close()
	file.keeper.close()
	FILES.delete(params.key)
}

/** The project's in-memory file: its key, each part encoded already, made one path segment. */
function fileName(params: { key: string }): string {
	return `file:/${encodeURIComponent(params.key)}?vfs=memdb`
}

/** The project's key in this realm's maps (`projectKeyOf`). */
function keyOf(params: { name: string; dialecteId: string }): string {
	return projectKeyOf({ dialecteId: params.dialecteId, project: params.name })
}

/**
 * The project's in-memory file can grow no more: its size limit set through a connection of its own (the
 * limit belongs to the file, every connection meets it; a limit below the file's size becomes its size,
 * so 0 caps it where it is, with no read of a file its engine holds). A test tool: what an origin out of
 * storage is to the engine.
 */
export async function fillInProcessFile(params: {
	name: string
	dialecteId: string
}): Promise<void> {
	const sqlite3 = await loadSqlite({ wasmUrl: realmWasmUrl() })
	const db = new sqlite3.oo1.DB(fileName({ key: keyOf(params) }), 'c')
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
