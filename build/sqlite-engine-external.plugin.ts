import {
	SQLITE_ENGINE_CHUNK,
	SQLITE_ENGINE_IMPORT,
	SQLITE_ENTRY,
} from './sqlite-engine-external.plugin.constants'

import type { Plugin } from 'vite'

/**
 * The main build's step on the engine's chunk: the dynamic import of the `sqlite` entry kept external, so that entry
 * reaches the file the engine build writes beside it and carries nothing of the engine itself.
 */
export function sqliteEngineExternal(): Plugin {
	return {
		name: 'dialecte:sqlite-engine-external',
		apply: 'build',
		enforce: 'pre',
		resolveId(source, importer) {
			if (source !== SQLITE_ENGINE_IMPORT || importer !== SQLITE_ENTRY) return null
			return { id: SQLITE_ENGINE_CHUNK, external: true }
		},
	}
}
