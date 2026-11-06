import { ENGINE_LOCK_PREFIX } from './engine.constants'

import { projectKeyOf } from '@/store/project-key'

/** The Web Lock the engine of a project holds while it runs: one engine at a time holds the project's files. */
export function engineLockNameOf(params: { dialecteId: string; project: string }): string {
	return `${ENGINE_LOCK_PREFIX}${projectKeyOf(params)}`
}
