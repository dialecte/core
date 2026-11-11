import { GATE_SELECTION_SCHEMA, TEST_FILE_SUFFIX } from './test-scope.constants'

import type { GateScope, GateSelection, TestSelection } from './test-scope.types'

/** A browser file's id for the gate: its file name, without its folder and `.test.ts`. */
function idOf(params: { path: string }): string {
	const name = params.path.slice(params.path.lastIndexOf('/') + 1)
	return name.endsWith(TEST_FILE_SUFFIX) ? name.slice(0, -TEST_FILE_SUFFIX.length) : name
}

/** What the step writes for its gate: each selected browser file under its id, with the reasons it runs. */
export function gateSelectionOf(params: {
	scope: GateScope
	selection: TestSelection
}): GateSelection {
	const { scope, selection } = params
	return {
		schema: GATE_SELECTION_SCHEMA,
		base: scope.base,
		tree: scope.tree,
		changed: scope.changed.length,
		selected: selection.browserFiles.map((file) => ({
			id: idOf({ path: file.path }),
			reasons: file.reasons,
		})),
		skipped: [],
	}
}
