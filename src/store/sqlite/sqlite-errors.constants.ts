import { defineErrors } from '@/errors/errors'
import { CORE_DOCS_URL } from '@/errors/errors.constants'

/**
 * The errors only SQLite storage raises, declared by the SQLite side (`@dialecte/core/sqlite`), not by core's catalogue:
 * its engine, its worker, the origin's hub and the engine's registration. Their keys and codes are the ones these errors
 * always had. An error of this catalogue is a `DialecteError` like any other; a consumer narrows its key with
 * `isKnownDialecteError(error, { catalogues: [SQLITE_ERRORS] })`.
 *
 * @intent tell which SQLite storage error was thrown, narrow the key of an error SQLite storage raised, word an error of the engine, the hub or the engine's registration for a user
 */
export const SQLITE_ERRORS = defineErrors({
	STORE_PROTOCOL_MISMATCH: {
		code: 'D1012',
		message: 'Another version of the library holds the shared store connection',
		explanation: {
			when: "Another version of the library already holds the origin's hub, or an engine worker speaks another wire than the page (another tab runs an older or newer build, or the worker file was built from another copy).",
			fix: 'Close the other tabs of the app, or reload them all on the same version; build the engine worker file from the copy of `@dialecte/core` the page uses.',
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	STORE_REALM_ID_TAKEN: {
		code: 'D1013',
		message: 'A view with this id is already connected to the shared store',
		explanation: {
			when: "A view joined the origin's hub with an id another connected view already uses.",
			fix: 'Give each view its own id; reload the page that reused one.',
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	STORE_REALM_UNKNOWN: {
		code: 'D1014',
		message: 'The shared store does not know this view',
		explanation: {
			when: "A view spoke to the origin's hub without having joined it, or after it left; or a child view was bound by a page the hub no longer knows.",
			fix: 'Join (open the project) before reading or writing; reload a view that was disconnected; a child is bound again by its page (`createHubPort`, then `adoptHubPort`).',
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	STORE_HUB_SPAWNERS_FIXED: {
		code: 'D1019',
		message: "The page's hub connection runs another version of this dialecte's engine",
		explanation: {
			when: "`registerSqliteEngine({ url, dialectes })` named two versions of one dialecte (nothing kept), or the engines the app registered name a dialecte the page's connection already runs at another version, as `connectHub()` or a project opening on `sqlite` offers them to the hub: a page runs one version of each dialecte's engine (two would split a project's views between two engines). `meta.spawners` names the dialectes (id and version) refused; nothing of the call was added, nothing opened.",
			fix: 'Ship one version of each dialecte in the app, and name it once in `registerSqliteEngine({ url, dialectes })` and in `serveSqliteEngine({ dialectes })`, from the copy the app opens its projects with.',
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	STORE_SQLITE_ENGINE_FIXED: {
		code: 'D1020',
		message: "This page's SQLite engine is registered already",
		explanation: {
			when: 'A second `registerSqliteEngine({ url, dialectes })` named another URL or other dialectes than the first (the same URL and the same dialectes, in any order, do nothing: a module evaluated twice). There is no additive call. `meta`: `registered` (kept), `asked` (refused), each `{ url, dialectes }`.',
			fix: 'Name all the dialectes of the app in one call, once, before the first project opens; the worker file serves them all (`serveSqliteEngine({ dialectes })`).',
			docs: `${CORE_DOCS_URL}/api/dialecte#the-engine-worker-and-its-packaging`,
		},
	},
	PROJECT_LAYOUT_OUTDATED: {
		code: 'D7005',
		message: 'Project stored by another version of the library',
		explanation: {
			when: "The project's SQLite file was stored by another version of the library (another layout); nothing was written to it.",
			fix: "Delete the project (the dialecte factory's `destroyProject({ name, storage: { type: 'sqlite' } })`) and import its files again with this version.",
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	PROJECT_ENGINE_UNAVAILABLE: {
		code: 'D7006',
		message: 'No view can start the project engine',
		explanation: {
			when: "The project's SQLite engine could not be started or reached: its worker failed to load, could not load the engine's chunk (a build or a precache list that leaves it out), or never answered its open within the open budget; through the origin's hub, no open view offers an engine for the project's dialecte, or the engine never said it opened; a destroy still running past the open budget, or one asked by a page suspended before the hub granted it.",
			fix: "Keep one tab of the app open and reload; check the `url` given to `registerSqliteEngine` points at the app's engine worker file and that it loads (the console names a script that fails); a destroy refused so is asked again once the project is closed elsewhere.",
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	PROJECT_ENGINE_BUSY: {
		code: 'D7007',
		message: 'The project is still held by another engine',
		explanation: {
			when: "Another SQLite engine still holds the project's files (another tab or a worker that did not stop).",
			fix: 'Close the other tabs of the app, then open the project again.',
			docs: `${CORE_DOCS_URL}/api/project#sqlite-errors`,
		},
	},
	PROJECT_DATABASE_LOST: {
		code: 'D7012',
		message: "The project's database is gone",
		explanation: {
			when: "The project's files hold data but none of them is its SQLite database any more: the database file's header was damaged (by the disk, another program, or site data changed outside the app). Nothing is opened or changed: no empty database is made in its place. `meta.project` names the project.",
			fix: "The project's data cannot be read back. Offer the user a reset, never automatically: `destroy()` on the same Project instance whose `open` was refused (keep it: `const project = new Project(params)`, then `await project.open(name)`) removes what the refused store holds, without opening it; `open(name)` then makes it again, empty, and its documents can be imported again.",
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	PROJECT_ENGINE_NOT_DECLARED: {
		code: 'D7015',
		message: 'This project has no engine to open it on SQLite',
		explanation: {
			when: "A project was opened on `storage: { type: 'sqlite' }` but made by no dialecte's project factory: its dialecte's id or version is known to no one, so no engine can be asked for it. Nothing was opened.",
			fix: "Make the project with the dialecte's project factory (`createProjectFactory({ dialecte })`, as a dialecte package exports it), or open it on another storage.",
			docs: `${CORE_DOCS_URL}/api/project#sqlite-storage`,
		},
	},
	PROJECT_SQLITE_ENGINE_NOT_REGISTERED: {
		code: 'D7017',
		message: 'SQLite storage needs the engine registered for this dialecte',
		explanation: {
			when: "A project was opened (or destroyed by name) on `storage: { type: 'sqlite' }` in a realm that can store, but the app told the page of no engine for its dialecte: no `registerSqliteEngine` call, or one that does not name it. Nothing was started. A child its page bound through `adoptHubPort` is not refused: it goes through its page's engine. `meta`: `project`, `dialecteId`.",
			fix: "Write the app's one worker file (`serveSqliteEngine({ dialectes })`) and call `registerSqliteEngine({ url, dialectes })` from `@dialecte/core/sqlite` once, before the first project opens, naming every dialecte of the app; `url` is a `?worker&url` import of that file. The registration is the page's: a frame of the same origin joining the hub on its own registers too (or is bound by its page); a frame of another origin never registers - it joins through `adoptHubPort` before it opens a project. Registered already? The registration is shared by every copy of @dialecte/core of the same SQLite version in the realm: one made by a copy of another version (a dialecte bringing its own core) is not seen - align the core versions.",
			docs: `${CORE_DOCS_URL}/api/dialecte#the-engine-worker-and-its-packaging`,
		},
	},
})
