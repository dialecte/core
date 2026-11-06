/**
 * A project's key wherever its engine is found - the engine's Web Lock, its files' directory, the maps of the
 * realms and of the hub: its dialecte's id and its name, each URI-encoded, joined by `/`. Two dialectes'
 * projects of one name are two projects; no part can be read as the other.
 */
export function projectKeyOf(params: { dialecteId: string; project: string }): string {
	const { dialecteId, project } = params
	return `${encodeURIComponent(dialecteId)}/${encodeURIComponent(project)}`
}
