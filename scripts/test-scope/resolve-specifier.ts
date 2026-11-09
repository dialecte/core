import { existsSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import { RESOLVED_SUFFIXES, SOURCE_ALIAS, SPECIFIER_QUERY } from './test-scope.constants'

function isFile(params: { root: string; path: string }): boolean {
	const path = join(params.root, params.path)
	return existsSync(path) && statSync(path).isFile()
}

/** Whether a specifier names a file of the package (relative or `@/`), whatever it resolves to. */
export function isLocalSpecifier(params: { specifier: string }): boolean {
	const { specifier } = params
	return specifier.startsWith('.') || specifier.startsWith(SOURCE_ALIAS.prefix)
}

/**
 * The file of the package a specifier names from `from` (its query stripped, `@/` read as `src/`, the suffixes vite
 * tries), or none: a package, or a local specifier naming no file.
 */
export function resolveSpecifier(params: {
	root: string
	from: string
	specifier: string
}): string | undefined {
	const { root, from } = params
	const specifier = params.specifier.replace(SPECIFIER_QUERY, '')
	if (!isLocalSpecifier({ specifier })) return undefined
	const base = specifier.startsWith(SOURCE_ALIAS.prefix)
		? `${SOURCE_ALIAS.folder}${specifier.slice(SOURCE_ALIAS.prefix.length)}`
		: join(dirname(from), specifier)
	return RESOLVED_SUFFIXES.map((suffix) => normalize(`${base}${suffix}`)).find((path) =>
		isFile({ root, path }),
	)
}
