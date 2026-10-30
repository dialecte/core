/** A module the test-entry scan reads in its own test: a type named only at a generic's second level. */
// not re-exported by this module: a consumer of it could not name the types
import type { Recursive, RecursiveInterface } from './test-entry-scan-recursive.types'

export function startRecursive(): Recursive<number> | undefined {
	return undefined
}

export function startRecursiveInterface(): RecursiveInterface<number> | undefined {
	return undefined
}
