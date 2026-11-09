import { selectTests } from './select-tests'
import { PACKAGE_ROOT } from './test-scope.constants'
import { BROWSER_FILES, T3_FILES } from './test-scope.fixtures'

import { describe, expect, it } from 'vitest'

import type { BrowserTier, ScopeChanges, TestSelection, TestTier } from './test-scope.types'

// The cases run on the package's own tree: they pin what a change of core selects today. A case that turns red after an
// import refactor under src/ may be the graph that changed, not the tool: check the edge the case names first.

/** How long one case may take: each scans the import graph of every browser file of the package. */
const SELECTION_CASE_TIMEOUT_MS = 30_000

type SelectionCase = {
	changes: ScopeChanges
	tiers: TestTier[]
	/** Each of these is selected, in that tier, with a reason matching the pattern. */
	selected?: { path: string; tier: BrowserTier; reason: RegExp }[]
	/** None of these is selected. */
	notSelected?: string[]
	/** Exactly these browser files are selected (any reason). */
	exactly?: readonly string[]
	/** The selected browser files come in the config's order. */
	inConfigOrder?: boolean
}

const CASES: Record<string, SelectionCase> = {
	'a docs-only change: T0-T2, no browser file': {
		changes: { kind: 'files', files: ['doc/guide/development/testing.md', 'README.md'] },
		tiers: ['T0', 'T1', 'T2'],
		exactly: [],
	},
	'a change in the errors module: the SQLite worker and hub files through the import closure, and the T3 files':
		{
			changes: { kind: 'files', files: ['src/errors/errors.ts'] },
			tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
			selected: [
				{
					path: 'src/store/sqlite/served/hub/hub-client.test.ts',
					tier: 'T4',
					reason: /src\/errors\/errors\.ts/,
				},
				{
					path: 'src/store/sqlite/runtime/serve-sqlite-engine.test.ts',
					tier: 'T4',
					reason: /src\/errors\/errors\.ts/,
				},
				{ path: 'src/utils/save-to-disk.test.ts', tier: 'T3', reason: /src\/errors\/errors\.ts/ },
			],
		},
	'a change in the engine build config: every browser file, the config named': {
		changes: { kind: 'files', files: ['vite.engine.config.ts'] },
		tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
		exactly: BROWSER_FILES,
		inConfigOrder: true,
		selected: [
			{
				path: 'src/store/contract/store-contract.test.ts',
				tier: 'T4',
				reason: /vite\.engine\.config\.ts/,
			},
			{ path: 'src/utils/save-to-disk.test.ts', tier: 'T3', reason: /vite\.engine\.config\.ts/ },
		],
	},
	'a package.json below the root (an eval fixture) is not the package manifest: T0-T2, no browser file':
		{
			changes: {
				kind: 'files',
				files: ['skills/dialecte/evals/sqlite-engine-wiring/files/package.json'],
			},
			tiers: ['T0', 'T1', 'T2'],
			exactly: [],
		},
	'a change in a tsconfig and in a build plugin: every browser file': {
		changes: {
			kind: 'files',
			files: ['tsconfig.build.json', 'build/sqlite-wasm.plugin.ts'],
		},
		tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
		exactly: BROWSER_FILES,
		selected: [
			{ path: 'src/store/sqlite/load-sqlite.test.ts', tier: 'T4', reason: /tsconfig\.build\.json/ },
			{
				path: 'src/store/sqlite/load-sqlite.test.ts',
				tier: 'T4',
				reason: /build\/sqlite-wasm\.plugin\.ts/,
			},
		],
	},
	'a change in the lock file: every browser file': {
		changes: { kind: 'files', files: ['package-lock.json'] },
		tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
		exactly: BROWSER_FILES,
	},
	'a change in a worker no import reaches: the files that start it, not the others': {
		changes: { kind: 'files', files: ['src/store/sqlite/served/hub/hub.worker.ts'] },
		tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
		selected: [
			{
				path: 'src/store/sqlite/served/hub/hub.browser.test.ts',
				tier: 'T4',
				reason: /hub\.worker\.ts/,
			},
		],
		notSelected: [
			'src/store/sqlite/load-sqlite.test.ts',
			'src/store/sqlite/served/client/engine-client.page-lifecycle.test.ts',
		],
	},
	'a changed browser test file: that file, and the T3 files (a source changed); no other store file':
		{
			changes: { kind: 'files', files: ['src/store/sqlite/load-sqlite.test.ts'] },
			tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
			exactly: ['src/store/sqlite/load-sqlite.test.ts', ...T3_FILES],
			selected: [{ path: 'src/store/sqlite/load-sqlite.test.ts', tier: 'T4', reason: /changed/ }],
		},
	'a deleted source file still counts as a source change: the T3 files': {
		changes: { kind: 'files', files: ['src/no-longer-here.ts'] },
		tiers: ['T0', 'T1', 'T2', 'T3'],
		exactly: T3_FILES,
	},
	'unknown changes (a base git cannot resolve): every browser file, the reason given': {
		changes: { kind: 'unknown', reason: 'the base no-such-ref is not a ref of this repository' },
		tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
		exactly: BROWSER_FILES,
		selected: [
			{
				path: 'src/store/contract/store-contract.test.ts',
				tier: 'T4',
				reason: /no-such-ref/,
			},
		],
	},
}

/** What a case checks of a selection, read the same way from the selection and from the case. */
type SelectionView = {
	tiers: TestTier[]
	exactly?: string[]
	order?: string
	selected: { path: string; tier?: BrowserTier; reasonMatches: boolean }[]
	selectedAmongNotSelected: string[]
}

function viewOf(params: { selection: TestSelection; testCase: SelectionCase }): SelectionView {
	const { selection, testCase } = params
	const paths = selection.browserFiles.map((file) => file.path)
	return {
		tiers: selection.tiers,
		...(testCase.exactly ? { exactly: [...paths].sort() } : {}),
		...(testCase.inConfigOrder
			? {
					order:
						paths.join('\n') === BROWSER_FILES.filter((path) => paths.includes(path)).join('\n')
							? 'the config order'
							: paths.join(', '),
				}
			: {}),
		selected: (testCase.selected ?? []).map(function found(expected) {
			const file = selection.browserFiles.find((selected) => selected.path === expected.path)
			return {
				path: expected.path,
				tier: file?.tier,
				reasonMatches: (file?.reasons ?? []).some((reason) => expected.reason.test(reason)),
			}
		}),
		selectedAmongNotSelected: (testCase.notSelected ?? []).filter((path) => paths.includes(path)),
	}
}

function expectedViewOf(testCase: SelectionCase): SelectionView {
	return {
		tiers: testCase.tiers,
		...(testCase.exactly ? { exactly: [...testCase.exactly].sort() } : {}),
		...(testCase.inConfigOrder ? { order: 'the config order' } : {}),
		selected: (testCase.selected ?? []).map((expected) => ({
			path: expected.path,
			tier: expected.tier,
			reasonMatches: true,
		})),
		selectedAmongNotSelected: [],
	}
}

describe('selectTests', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(
			name,
			() => {
				expect(
					viewOf({
						selection: selectTests({ root: PACKAGE_ROOT, changes: testCase.changes }),
						testCase,
					}),
				).toEqual(expectedViewOf(testCase))
			},
			SELECTION_CASE_TIMEOUT_MS,
		)
	}

	it(
		'two changed files reaching one store file: one reason for each, however many paths reach it',
		() => {
			expect(
				selectTests({
					root: PACKAGE_ROOT,
					changes: { kind: 'files', files: ['src/errors/errors.ts', 'src/utils/index.ts'] },
				})
					.browserFiles.find(
						(file) => file.path === 'src/store/sqlite/served/hub/hub-client.test.ts',
					)
					?.reasons.map(
						(reason) => /src\/errors\/errors\.ts|src\/utils\/index\.ts/.exec(reason)?.[0],
					),
			).toEqual(['src/errors/errors.ts', 'src/utils/index.ts'])
		},
		SELECTION_CASE_TIMEOUT_MS,
	)

	it('every browser file is classified T3 or T4 and the T3 list is the non-store files', () => {
		expect(
			selectTests({ root: PACKAGE_ROOT, changes: { kind: 'files', files: ['package.json'] } })
				.browserFiles.filter((file) => file.tier === 'T3')
				.map((file) => file.path)
				.sort(),
		).toEqual([...T3_FILES].sort())
	})
})
