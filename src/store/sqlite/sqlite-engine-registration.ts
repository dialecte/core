import { realmSqliteStorage } from '../sqlite-storage'

import { throwDialecteError } from '@/errors'

import type { SqliteEngineRegistration, SqliteStorage } from '../sqlite-storage.types'

/**
 * Tell this page where the app's SQLite engine is: `url`, its one worker file (a `?worker&url` import of the file that
 * calls `serveSqliteEngine`), and `dialectes`, the dialectes that file serves (their declarations fit; only each id and
 * version are kept, as plain data on the realm's `sqlite` storage kind, so every copy of the library finds them). Call
 * it once, before the first project opens on `sqlite`; a project of a dialecte it does not name is refused
 * `PROJECT_SQLITE_ENGINE_NOT_REGISTERED`. The same URL and the same dialectes again, in any order, do nothing (a module
 * evaluated twice). Anything else is refused `STORE_SQLITE_ENGINE_FIXED`, the first kept: there is no additive call, the
 * app names all its dialectes at once. Two versions of one dialecte are refused `STORE_HUB_SPAWNERS_FIXED`, nothing
 * kept. A child frame of another origin does not register: its shell does, and it joins through `adoptHubPort`.
 *
 * @intent use SQLite storage in an app, tell the page where an app's SQLite engine worker is, register the dialectes an app's engine worker serves, open projects of several dialectes on one SQLite engine worker
 */
export function registerSqliteEngine(params: SqliteEngineRegistration): void {
	const { url, dialectes } = params
	refuseTwoVersions({ dialectes })
	const asked: SqliteEngineRegistration = { url, dialectes: idsAndVersionsOf({ dialectes }) }
	const kind = realmKindOf({ url })
	const registered = kind.engine
	if (!registered) {
		kind.engine = asked
		return
	}
	if (sameRegistration({ registered, asked })) return
	throwDialecteError('STORE_SQLITE_ENGINE_FIXED', {
		detail: `This page's SQLite engine is registered already (${describeRegistration({ registration: registered })}), not ${describeRegistration({ registration: asked })}: an app names all its dialectes in one registration`,
		meta: { registered, asked },
	})
}

/**
 * The engine the app registered, read from the realm's `sqlite` storage kind: whichever copy of the library registered
 * it, this copy finds it. None until the app registers one.
 */
export function registeredSqliteEngine(): SqliteEngineRegistration | undefined {
	return realmSqliteStorage()?.engine
}

/** The kind to keep the registration on: importing `@dialecte/core/sqlite`, the only way here, has put it there. */
function realmKindOf(params: { url: string }): SqliteStorage {
	const kind = realmSqliteStorage()
	if (!kind) {
		throwDialecteError('ASSERTION_FAILED', {
			detail: `The engine worker ${params.url} is registered in a realm with no \`sqlite\` storage kind: importing @dialecte/core/sqlite registers it`,
		})
	}
	return kind
}

/** Each dialecte once, its id and version only: no hook, no config stays on the realm. */
function idsAndVersionsOf(params: {
	dialectes: SqliteEngineRegistration['dialectes']
}): SqliteEngineRegistration['dialectes'] {
	return params.dialectes
		.filter(function firstOfItsKind({ id, version }, index, dialectes) {
			return (
				dialectes.findIndex(function sameDialecte(other) {
					return other.id === id && other.version === version
				}) === index
			)
		})
		.map(function idAndVersionOf({ id, version }) {
			return { id, version }
		})
}

/** `STORE_HUB_SPAWNERS_FIXED` when the call names two versions of one dialecte: a page runs one of each. */
function refuseTwoVersions(params: { dialectes: SqliteEngineRegistration['dialectes'] }): void {
	const conflicting = params.dialectes.filter(function hasAnotherVersion({ id, version }, _, all) {
		return all.some(function sameIdOtherVersion(other) {
			return other.id === id && other.version !== version
		})
	})
	if (conflicting.length === 0) return
	const spawners = conflicting.map(function asSpawner({ id, version }) {
		return { dialecteId: id, dialecteVersion: version }
	})
	throwDialecteError('STORE_HUB_SPAWNERS_FIXED', {
		detail: `One registration names ${describeDialectes({ dialectes: conflicting })}: a page runs one version of each dialecte's engine`,
		meta: { spawners },
	})
}

/** The same URL and the same set of dialectes (id and version), in any order. */
function sameRegistration(params: {
	registered: SqliteEngineRegistration
	asked: SqliteEngineRegistration
}): boolean {
	const { registered, asked } = params
	if (registered.url !== asked.url) return false
	if (registered.dialectes.length !== asked.dialectes.length) return false
	return asked.dialectes.every(function isRegistered({ id, version }) {
		return registered.dialectes.some(function sameDialecte(other) {
			return other.id === id && other.version === version
		})
	})
}

function describeRegistration(params: { registration: SqliteEngineRegistration }): string {
	const { url, dialectes } = params.registration
	return `${url} for ${describeDialectes({ dialectes })}`
}

/** Dialectes as their id and version, `no dialecte` for none. */
function describeDialectes(params: { dialectes: SqliteEngineRegistration['dialectes'] }): string {
	const { dialectes } = params
	if (dialectes.length === 0) return 'no dialecte'
	return dialectes
		.map(function nameOf({ id, version }) {
			return `${id}@${version}`
		})
		.join(', ')
}
