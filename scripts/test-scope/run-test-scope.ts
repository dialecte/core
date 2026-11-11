/**
 * Runs the browser tests a change needs: `npm run test:scope [-- --base <ref>] [--list] [--selection-out <path>]`.
 * Under a gate (a scoped step), the changes are the paths the gate hands (`DIALECTE_GATE_CHANGED`) and the selection is
 * written where it says (`DIALECTE_GATE_SELECTION`). Elsewhere the base is `--base`, else `main` (`origin/main` when
 * `main` does not resolve), the changes counted from the merge base of the base and HEAD, the worktree's uncommitted
 * and untracked files included. A change that needs no browser test file runs nothing. The node tiers always run, in their
 * own step (`npm run test:node`). `--list` prints the selection and runs nothing; `--selection-out` writes it as JSON;
 * test files named on the command line run instead of the selection (a gate's serial rerun of its failing files);
 * every other argument goes to vitest.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertEachPatternMatches } from './assert-each-pattern-matches'
import { browserRunOf } from './browser-run-of'
import { changesSinceBase } from './changes-since-base'
import { gateScopeOf } from './gate-scope-of'
import { gateSelectionOf } from './gate-selection-of'
import { namedFilesOf } from './named-files-of'
import { optionValueOf } from './option-value'
import { resolveBase } from './resolve-base'
import { selectTests } from './select-tests'
import { selectionReportOf } from './selection-report-of'
import {
	BASE_FLAG,
	LIST_FLAG,
	NON_IMPORT_EDGES,
	PACKAGE_ROOT,
	SELECTION_OUT_FLAG,
	STORE_TEST_FILE_PATTERNS,
} from './test-scope.constants'
import { vitestArgumentsOf } from './vitest-arguments-of'

import type { SelectionReport } from './test-scope.types'

/** The selection as a person reads it: the base, the tiers, each browser file with its reasons, the run's note. */
function printSelection(params: { report: SelectionReport }): void {
	const { report } = params
	const lines = [
		`test scope: base ${report.base}, ${report.changes.kind === 'files' ? `${report.changes.files.length} changed file(s)` : report.changes.reason}`,
		`tiers: ${report.tiers.join(', ')}`,
		...report.browserFiles.map(function fileLine(file) {
			const more = file.reasons.length > 1 ? ` (+${file.reasons.length - 1} more)` : ''
			return `  ${file.tier} ${file.path}: ${file.reasons[0]}${more}`
		}),
		...(report.run.note ? [`note: ${report.run.note}`] : []),
	]
	process.stdout.write(`${lines.join('\n')}\n`)
}

function runTestScope(params: { argv: readonly string[] }): number {
	const { argv } = params
	assertEachPatternMatches({
		root: PACKAGE_ROOT,
		patterns: [...NON_IMPORT_EDGES.map((edge) => edge.pattern), ...STORE_TEST_FILE_PATTERNS],
		owner: 'the test scope',
	})
	// a gate hands the paths it judges; `--base` on the command line (CI) asks git instead
	const scope = optionValueOf({ argv, flag: BASE_FLAG })
		? undefined
		: gateScopeOf({ env: process.env })
	const { base, changes } = scope
		? { base: scope.base, changes: { kind: 'files' as const, files: scope.changed } }
		: changesSinceBase({ root: PACKAGE_ROOT, base: resolveBase({ argv, env: process.env }) })
	const selection = selectTests({ root: PACKAGE_ROOT, changes })
	if (scope) {
		writeFileSync(
			scope.selectionPath,
			`${JSON.stringify(gateSelectionOf({ scope, selection }), null, '\t')}\n`,
		)
	}
	const run = browserRunOf({ selection, namedFiles: namedFilesOf({ argv }) })
	const report = selectionReportOf({ base, changes, selection, run })
	printSelection({ report })
	const selectionOut = optionValueOf({ argv, flag: SELECTION_OUT_FLAG })
	if (selectionOut !== undefined) {
		const path = resolve(selectionOut)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`)
	}
	if (argv.includes(LIST_FLAG) || run.files.length === 0) return 0
	const vitest = spawnSync('npx', ['vitest', ...vitestArgumentsOf({ argv, run })], {
		cwd: PACKAGE_ROOT,
		stdio: 'inherit',
	})
	return vitest.status ?? 1
}

/** A refused argument, an unmatched pattern, a git failure: one line naming it, exit 1. */
function runOrExplain(params: { argv: readonly string[] }): number {
	try {
		return runTestScope(params)
	} catch (error) {
		process.stderr.write(`test:scope: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}

process.exitCode = runOrExplain({ argv: process.argv.slice(2) })
