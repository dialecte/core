import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
	IMPORT_SPECIFIER,
	SCANNED_EXTENSIONS,
	TYPE_ONLY_IMPORT,
	URL_SPECIFIER,
} from './test-scope.constants'

/**
 * The specifiers a file reaches at runtime, as written: its imports, re-exports, dynamic imports, requires and the files
 * it starts by address; imports of types only left out. A file that is not code, or not there, has none.
 */
export function runtimeSpecifiersOf(params: { root: string; file: string }): string[] {
	const { root, file } = params
	const path = join(root, file)
	if (!SCANNED_EXTENSIONS.test(file) || !existsSync(path)) return []
	const text = readFileSync(path, 'utf8').replace(TYPE_ONLY_IMPORT, '')
	return [...text.matchAll(IMPORT_SPECIFIER), ...text.matchAll(URL_SPECIFIER)].map(
		(match) => match[1],
	)
}
