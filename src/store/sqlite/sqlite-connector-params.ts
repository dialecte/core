import { refuseUnnamableProject } from '../project-name'
import { SQLITE_ERRORS } from './sqlite-errors.constants'

import { throwDialecteError } from '@/errors'

import type { SqliteConnectorParams } from './sqlite-storage.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'

/**
 * What a project on SQLite storage connects with: its name and its dialecte - a name or dialecte id no store can hold
 * refused `PROJECT_NAME_INVALID`, a project made by no factory (no dialecte id or version)
 * `PROJECT_ENGINE_NOT_DECLARED`. The engine it reaches is the one the app registered, read as it connects.
 */
export function sqliteConnectorParamsOf(params: {
	name: string
	runtime: StoreRuntime
	dialecteId: string | undefined
}): SqliteConnectorParams {
	const { name, runtime, dialecteId } = params
	const { dialecteVersion, perf } = runtime
	refuseUnnamableProject({ project: name, dialecteId })
	if (dialecteId === undefined || dialecteVersion === undefined) {
		throwDialecteError(SQLITE_ERRORS.PROJECT_ENGINE_NOT_DECLARED, {
			detail: `Project "${name}" asks for SQLite storage, but no dialecte's factory made it: no engine is known to start (dialecte ${dialecteId ?? 'none'}, version ${dialecteVersion ?? 'none'})`,
			meta: { project: name, dialecteId, dialecteVersion },
		})
	}
	return { name, dialecteId, dialecteVersion, perf }
}
