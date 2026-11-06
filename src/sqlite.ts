/**
 * `@dialecte/core/sqlite` - SQLite storage, opt-in: importing this entry once (the app's entry, a test runner's setup
 * file) registers the `sqlite` storage kind, so projects open on `storage: { type: 'sqlite' }` - one engine per
 * project in a worker, shared by every tab, window and iframe of the app through the origin's hub. It carries what
 * only SQLite storage uses: the hub (`connectHub`, `adoptHubPort`) and `listProjects`. One entry serves both sides of
 * an app: its page tells where the engine is (`registerSqliteEngine`), its one engine worker file serves it
 * (`serveSqliteEngine`). The engine itself and sqlite-wasm are reached through a lazy import inside
 * `serveSqliteEngine`, so a page, which never calls it, holds neither; the worker file, which imports this entry, also
 * carries its page side. An app that never imports it neither emits nor downloads the SQLite engine's side, its wasm or
 * the hub's worker; `{ type: 'sqlite' }` there is refused `PROJECT_SQLITE_NOT_IMPORTED`.
 */
import { registerSqliteStorage } from './store/sqlite-storage'
import { runEngineControlLoop } from './store/sqlite/runtime/engine-control-loop'
import { sqliteStoreOf } from './store/sqlite/sqlite-store-of'

import type { ServeSqliteEngineParams } from './store/sqlite/runtime/serve-sqlite-engine.types'

registerSqliteStorage({ storage: { storeOf: sqliteStoreOf } })

export { adoptHubPort, connectHub } from './store/hub-public'
export { listProjects } from './store/sqlite/list-projects'
export { registerSqliteEngine } from './store/sqlite/sqlite-engine-registration'
export type { ProjectListing, ProjectListingState } from './store/sqlite/list-projects.types'
export type { HubPortHandle, HubRealm } from './store/engine/hub/hub-client.types'
export type { SqliteEngineRegistration } from './store/sqlite-storage.types'
export type {
	ServeSqliteEngineParams,
	SqliteEngineDialecte,
} from './store/sqlite/runtime/serve-sqlite-engine.types'

/**
 * This worker serves the engine of a project of any of the dialectes given, the one call of an app's engine worker
 * file: the realm that spawned it (or the hub, through it) opens a project of the dialecte it names, adopts clients,
 * closes and destroys it, each message answered once. A dialecte not given, or given at another version, is refused
 * as data with nothing touched. One worker file for all the app's dialectes, one project per worker instance; the
 * engine and its wasm stay out of the page's bundle.
 *
 * @intent serve the engines of an app's dialectes from one worker, write an app's engine worker file, keep sqlite-wasm out of the page's bundle
 */
export function serveSqliteEngine(params: ServeSqliteEngineParams): void {
	const { dialectes } = params
	runEngineControlLoop({
		dialectes,
		loadEngine: function loadEngine() {
			// in this file: the path holds in the built entry too, beside the engine's chunk
			return import('./sqlite-engine')
		},
	})
}
