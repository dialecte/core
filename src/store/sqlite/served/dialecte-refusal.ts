import { createDialecteError } from '@/errors'

/**
 * An engine asked for a project of another dialecte, or of another version of it - what an engine worker running
 * another dialecte than the one a realm asks gives: refused `PROJECT_DIALECTE_MISMATCH` or
 * `PROJECT_DIALECTE_VERSION_MISMATCH`, naming both. The engine refuses itself before it takes any lock or file; the realm refuses an engine that
 * answers otherwise than it asked (ending it, as a failed open), and a view asking a project whose engine it runs at
 * another version (never joined to it). A destroy names no version.
 */
export function refuseAnotherDialecte(params: {
	project: string
	engine: { dialecteId: string; dialecteVersion: string }
	asked: { dialecteId: string; dialecteVersion?: string }
}): void {
	const { project, engine, asked } = params
	if (asked.dialecteId !== engine.dialecteId) {
		throw createDialecteError('PROJECT_DIALECTE_MISMATCH', {
			detail: `"${project}" was asked as ${asked.dialecteId} of an engine of ${engine.dialecteId}: nothing was opened or removed`,
			meta: { project, projectDialecteId: engine.dialecteId, realmDialecteId: asked.dialecteId },
		})
	}
	if (asked.dialecteVersion === undefined || asked.dialecteVersion === engine.dialecteVersion)
		return
	throw createDialecteError('PROJECT_DIALECTE_VERSION_MISMATCH', {
		detail: `the engine of "${project}" runs ${engine.dialecteId} ${engine.dialecteVersion}, the view ${asked.dialecteVersion}`,
		meta: {
			project,
			dialecteId: engine.dialecteId,
			engineVersion: engine.dialecteVersion,
			realmVersion: asked.dialecteVersion,
		},
	})
}
