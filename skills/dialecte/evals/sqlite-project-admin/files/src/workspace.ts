import engineUrl from './engine.worker.ts?worker&url'

import { createProjectFactory } from '@dialecte/core'
import { registerSqliteEngine } from '@dialecte/core/sqlite'
import { SCL_DIALECTE } from '@dialecte/scl'

registerSqliteEngine({ url: engineUrl, dialectes: [SCL_DIALECTE] })

const createSclProject = createProjectFactory({ dialecte: SCL_DIALECTE })

/** Opens the substation's SCL project on SQLite storage. */
export async function openWorkspace(name: string) {
	return createSclProject({ storage: { type: 'sqlite' } }).open(name)
}

/** Deletes the substation's project without opening it. TODO */
export async function deleteWorkspace(name: string): Promise<void> {
	throw new Error(`TODO: delete ${name}`)
}

/**
 * The sentence the status bar shows for an error a save or an open threw. TODO: say when the write may or may not
 * have landed because the storage connection dropped, when the project was stored by another version of the app
 * (layout), and when the build forgot to load SQLite storage at all; anything else: 'Something went wrong'.
 */
export function describeFailure(thrown: unknown): string {
	return `TODO: describe ${typeof thrown}`
}
