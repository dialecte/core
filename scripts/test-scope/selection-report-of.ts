import type { BrowserRun, ScopeChanges, SelectionReport, TestSelection } from './test-scope.types'

/** What `--selection-out` writes for a run. */
export function selectionReportOf(params: {
	base: string
	changes: ScopeChanges
	selection: TestSelection
	run: BrowserRun
}): SelectionReport {
	const { base, changes, selection, run } = params
	return { base, changes, tiers: selection.tiers, browserFiles: selection.browserFiles, run }
}
