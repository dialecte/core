import { resolveSpecifier } from './resolve-specifier'
import { runtimeSpecifiersOf } from './runtime-specifiers-of'

/** The files of the package one file reaches directly at runtime: its imports and the files it starts by address. */
function readRuntimeEdges(params: { root: string; file: string }): string[] {
	const { root, file } = params
	return runtimeSpecifiersOf({ root, file }).flatMap(function resolved(specifier) {
		const found = resolveSpecifier({ root, from: file, specifier })
		return found === undefined ? [] : [found]
	})
}

/**
 * Every file of the package the given files reach at runtime, the files included (paths from `root`): imports,
 * re-exports, dynamic imports and requires (their query stripped, `@/` read as `src/`), and the files started by their
 * address (`new URL('./file', import.meta.url)`), which no import shows. Imports of types only are not followed: they
 * are erased at runtime and the type-check covers them. A package import reaches no file of the package.
 */
export function importClosureOf(params: {
	root: string
	files: readonly string[]
	/** The edges already read, by file: several closures over one tree share it, each file read once. */
	edgeCache?: Map<string, readonly string[]>
}): Set<string> {
	const { root, files, edgeCache = new Map<string, readonly string[]>() } = params
	const reached = new Set<string>()
	const pending = [...files]
	while (pending.length > 0) {
		const file = pending.pop()
		if (file === undefined || reached.has(file)) continue
		reached.add(file)
		let edges = edgeCache.get(file)
		if (edges === undefined) {
			edges = readRuntimeEdges({ root, file })
			edgeCache.set(file, edges)
		}
		for (const next of edges) if (!reached.has(next)) pending.push(next)
	}
	return reached
}
