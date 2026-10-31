import { ENGINE_LOCK_PREFIX } from './engine.constants'

/**
 * A project's key wherever its engine is found - the engine's Web Lock, its files' directory, the maps of the
 * realms and of the hub: its dialecte's id and its name, each URI-encoded, joined by `/`. Two dialectes'
 * projects of one name are two projects; no part can be read as the other.
 */
export function projectKeyOf(params: { dialecteId: string; project: string }): string {
	const { dialecteId, project } = params
	return `${encodeURIComponent(dialecteId)}/${encodeURIComponent(project)}`
}

/** The Web Lock the engine of a project holds while it runs: one engine at a time holds the project's files. */
export function engineLockNameOf(params: { dialecteId: string; project: string }): string {
	return `${ENGINE_LOCK_PREFIX}${projectKeyOf(params)}`
}
