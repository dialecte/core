import { browserRunOf } from './browser-run-of'
import { T3_FILES } from './test-scope.fixtures'

import { describe, expect, it } from 'vitest'

import type { BrowserRun, TestSelection } from './test-scope.types'

type RunCase = {
	selection: TestSelection
	namedFiles?: string[]
	run: BrowserRun
}

const SELECTION_OF_ONE: TestSelection = {
	tiers: ['T0', 'T1', 'T2', 'T4'],
	browserFiles: [
		{
			path: 'src/store/sqlite/load-sqlite.test.ts',
			tier: 'T4',
			reasons: ['src/store/sqlite/load-sqlite.test.ts changed'],
		},
	],
}

const CASES: Record<string, RunCase> = {
	'files named on the command line (a rerun of failing files): exactly those, the selection set aside, said in the note':
		{
			selection: SELECTION_OF_ONE,
			namedFiles: ['src/store/sqlite/served/hub/hub.browser.test.ts'],
			run: {
				files: ['src/store/sqlite/served/hub/hub.browser.test.ts'],
				note: 'the files named on the command line run, not the selection',
			},
		},
	'files named and nothing selected: the named files, no floor': {
		selection: { tiers: ['T0', 'T1', 'T2'], browserFiles: [] },
		namedFiles: ['src/utils/save-to-disk.test.ts'],
		run: {
			files: ['src/utils/save-to-disk.test.ts'],
			note: 'the files named on the command line run, not the selection',
		},
	},
	"a selection with browser files: exactly those, in the selection's order, no note": {
		selection: {
			tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
			browserFiles: [
				{
					path: 'src/store/sqlite/load-sqlite.test.ts',
					tier: 'T4',
					reasons: ['src/store/sqlite/load-sqlite.test.ts changed'],
				},
				{
					path: 'src/utils/save-to-disk.test.ts',
					tier: 'T3',
					reasons: ['src/utils/save-to-disk.ts changed'],
				},
			],
		},
		run: { files: ['src/store/sqlite/load-sqlite.test.ts', 'src/utils/save-to-disk.test.ts'] },
	},
	// interim: the cli's gate fails a test step that ran nothing; once it passes an empty selection, this floor goes
	'no browser file selected: the T3 files as the interim floor, the note saying what was selected and why they run':
		{
			selection: { tiers: ['T0', 'T1', 'T2'], browserFiles: [] },
			run: {
				files: [...T3_FILES],
				note: 'selected: T0-T2; T3 run as the interim floor until the cli passes empty selections',
			},
		},
}

describe('browserRunOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(
				browserRunOf({ selection: testCase.selection, namedFiles: testCase.namedFiles ?? [] }),
			).toEqual(testCase.run)
		})
	}
})
