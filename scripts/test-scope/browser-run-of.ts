import { NAMED_FILES_NOTE, NOTHING_SELECTED_NOTE } from './test-scope.constants'

import type { BrowserRun, TestSelection } from './test-scope.types'

/**
 * The browser files a run starts: the files named on the command line when there are some (a rerun), else the
 * selection's. A selection with no browser file runs nothing (a gate passes such a scoped step); the note says which
 * case it is.
 */
export function browserRunOf(params: {
	selection: TestSelection
	namedFiles: readonly string[]
}): BrowserRun {
	const { selection } = params
	if (params.namedFiles.length > 0) return { files: [...params.namedFiles], note: NAMED_FILES_NOTE }
	if (selection.browserFiles.length > 0) {
		return { files: selection.browserFiles.map((file) => file.path) }
	}
	return { files: [], note: NOTHING_SELECTED_NOTE }
}
