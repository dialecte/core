/**
 * `@dialecte/core/sqlite` - SQLite storage, opt-in: importing this entry once (the app's entry, a test runner's setup
 * file) registers the `sqlite` storage kind, so projects open on `storage: { type: 'sqlite' }` - one engine per
 * project in a worker, shared by every tab, window and iframe of the app through the origin's hub. It carries what
 * only SQLite storage uses: the hub (`connectHub`, `adoptHubPort`) and `listProjects`. An app that never imports it
 * neither emits nor downloads the SQLite engine's side, its wasm or the hub's worker; `{ type: 'sqlite' }` there is
 * refused `PROJECT_SQLITE_NOT_IMPORTED`.
 */
import { registerSqliteStorage } from './store/sqlite-storage'
import { sqliteStoreOf } from './store/sqlite/sqlite-store-of'

registerSqliteStorage({ storage: { storeOf: sqliteStoreOf } })

export { adoptHubPort, connectHub } from './store/hub-public'
export { listProjects } from './store/sqlite/list-projects'
export type { ProjectListing, ProjectListingState } from './store/sqlite/list-projects.types'
export type { ConnectHubParams, HubPortHandle, HubRealm } from './store/engine/hub/hub-client.types'
