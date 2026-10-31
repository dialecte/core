/** A module the test-entry scan reads in its own test: a generic that expands on every level. */
// not re-exported by this module: a consumer of it could not name the type
import type { Tree } from './test-entry-scan-edges.types'

export function plantTree(): Tree<string> | undefined {
	return undefined
}
