import { importClosureOf } from './import-closure'
import { isLocalSpecifier, resolveSpecifier } from './resolve-specifier'
import { runtimeSpecifiersOf } from './runtime-specifiers-of'

import type { UnresolvedSpecifier } from './test-scope.types'

function compareUnresolved(left: UnresolvedSpecifier, right: UnresolvedSpecifier): number {
	return left.from.localeCompare(right.from) || left.specifier.localeCompare(right.specifier)
}

/**
 * The local specifiers (relative or `@/`) in the runtime closure of the given files that name no file of the package,
 * sorted by file then specifier: what the closure silently leaves out.
 */
export function unresolvedSpecifiersOf(params: {
	root: string
	files: readonly string[]
}): UnresolvedSpecifier[] {
	const { root, files } = params
	return [...importClosureOf({ root, files })]
		.flatMap(function unresolvedIn(from) {
			return runtimeSpecifiersOf({ root, file: from })
				.filter(
					(specifier) =>
						isLocalSpecifier({ specifier }) &&
						resolveSpecifier({ root, from, specifier }) === undefined,
				)
				.map((specifier) => ({ from, specifier }))
		})
		.sort(compareUnresolved)
}
