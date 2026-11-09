import { selectionReportOf } from './selection-report-of'

import { describe, expect, it } from 'vitest'

import type { BrowserRun, ScopeChanges, TestSelection } from './test-scope.types'

const CHANGES: ScopeChanges = { kind: 'files', files: ['src/store/sqlite/load-sqlite.test.ts'] }
const SELECTION: TestSelection = {
	tiers: ['T0', 'T1', 'T2', 'T4'],
	browserFiles: [
		{
			path: 'src/store/sqlite/load-sqlite.test.ts',
			tier: 'T4',
			reasons: ['src/store/sqlite/load-sqlite.test.ts changed'],
		},
	],
}
const RUN: BrowserRun = { files: ['src/store/sqlite/load-sqlite.test.ts'] }

describe('selectionReportOf', () => {
	it('the base, the changes, the tiers, the browser files with their reasons and the run, as they are', () => {
		expect(
			selectionReportOf({ base: 'main', changes: CHANGES, selection: SELECTION, run: RUN }),
		).toEqual({
			base: 'main',
			changes: CHANGES,
			tiers: SELECTION.tiers,
			browserFiles: SELECTION.browserFiles,
			run: RUN,
		})
	})

	it('a run with a note keeps it: the interim floor is visible in the report', () => {
		const floor: BrowserRun = { files: ['src/utils/save-to-disk.test.ts'], note: 'the floor' }
		expect(
			selectionReportOf({
				base: 'main',
				changes: { kind: 'files', files: ['README.md'] },
				selection: { tiers: ['T0', 'T1', 'T2'], browserFiles: [] },
				run: floor,
			}).run,
		).toEqual(floor)
	})
})
