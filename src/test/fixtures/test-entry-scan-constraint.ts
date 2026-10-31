/** A module the test-entry scan reads in its own test: a type named only in the function's own constraint. */
// not re-exported by this module: a consumer of it could not name the type
import type { EdgeRow } from './test-entry-scan-edges.types'

// the type parameter is in no parameter and not in the return type: only the signature holds it
export function constrainedRow<GenericRow extends EdgeRow>(): void {
	void ([] as GenericRow[])
}
