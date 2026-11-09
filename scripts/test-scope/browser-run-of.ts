import { BROWSER_ONLY_TEST_FILES } from '../../vitest.config.constants'
import { browserTierOf } from './browser-tier-of'
import { INTERIM_FLOOR_NOTE, NAMED_FILES_NOTE } from './test-scope.constants'

import type { BrowserRun, TestSelection } from './test-scope.types'

/**
 * The browser files a run starts: the files named on the command line when there are some (a rerun), else the
 * selection's. A selection with no browser file runs the T3 files as an interim floor, so the gate's browser step
 * always counts tests, until the cli passes an empty selection; the note says which case it is.
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
	const floor = BROWSER_ONLY_TEST_FILES.map((file) => file.path).filter(
		(path) => browserTierOf({ path }) === 'T3',
	)
	return { files: floor, note: INTERIM_FLOOR_NOTE }
}
