import { fileURLToPath } from 'node:url'

import type {
	BrowserTier,
	KnownUnresolvedSpecifier,
	NonImportEdge,
	TestTier,
} from './test-scope.types'

/** The package root: the tool reads its tree and runs vitest there. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The browser tiers, in the order a selection lists them. */
export const BROWSER_TIERS: readonly BrowserTier[] = ['T3', 'T4']

/** The option naming the base ref. */
export const BASE_FLAG = '--base'

/** The option naming the file the selection is written to. */
export const SELECTION_OUT_FLAG = '--selection-out'

/**
 * The option naming the runner, `--runner vitest`, the only one: it exists so the `test:scope` script names vitest, which
 * is how @dialecte/cli 0.3.1 recognises a test step it reruns serially on its failing files. To remove once the cli's
 * scoped gate step is rerunnable by itself.
 */
export const RUNNER_FLAG = '--runner'

/** The runner `--runner` accepts. */
export const VITEST_RUNNER = 'vitest'

/** The options this tool reads that carry a value: vitest never sees them nor their value. */
export const OWN_VALUE_FLAGS: readonly string[] = [BASE_FLAG, SELECTION_OUT_FLAG, RUNNER_FLAG]

/** The option printing the selection without running a test. */
export const LIST_FLAG = '--list'

/** What a run says when it starts the T3 files for a selection with no browser file. */
export const INTERIM_FLOOR_NOTE =
	'selected: T0-T2; T3 run as the interim floor until the cli passes empty selections'

/** What a run says when it starts the files named on its command line instead of the selection. */
export const NAMED_FILES_NOTE = 'the files named on the command line run, not the selection'

/** A command-line argument naming a test file. */
export const TEST_FILE_ARGUMENT = /\.test\.[cm]?[jt]sx?$/

/** The vitest project the selected browser files run in. */
export const BROWSER_PROJECT = 'browser'

/** The variable a gate passes the lot's base ref in. */
export const GATE_BASE_VARIABLE = 'DIALECTE_GATE_BASE'

/** The base a run compares with when neither `--base` nor the gate names one. */
export const DEFAULT_BASE = 'main'

/** The base tried when the default base does not resolve (a fresh clone, a CI checkout with no local `main`). */
export const DEFAULT_BASE_FALLBACK = 'origin/main'

/**
 * The local specifiers in the store tests' closures that name no file, on purpose. Any other one fails the scope's
 * guard: a new alias, a `.js` suffix on a `.ts` import, a moved file would otherwise drop an edge and under-select.
 */
export const KNOWN_UNRESOLVED_SPECIFIERS: readonly KnownUnresolvedSpecifier[] = [
	{
		from: 'src/store/sqlite/served/client/worker-connector.test.ts',
		specifier: './no-such-engine.worker.ts',
		why: 'the address of an engine worker that does not exist: the connector refusing it',
	},
]

/** The tiers every change runs: node only, a few minutes, never routed. */
export const ALWAYS_RUN_TIERS: readonly TestTier[] = ['T0', 'T1', 'T2']

/** The browser-only test files that exercise a store (T4); the other browser-only files are T3. */
export const STORE_TEST_FILE_PATTERNS: readonly string[] = [
	'src/store/**/*.test.ts',
	'src/**/*.indexeddb.test.ts',
]

/** The folder whose change runs the T3 files, whatever the import graph says. */
export const SOURCE_FOLDER = 'src/'

/** Edges no import shows: a change there selects every browser file. */
export const NON_IMPORT_EDGES: readonly NonImportEdge[] = [
	{ pattern: 'vite.config.ts', why: 'the alias, plugins and build every test runs through' },
	{ pattern: 'vite.engine.config.ts', why: "the engine worker's build" },
	{ pattern: 'vitest.config*.ts', why: 'the test projects, their includes and their browser' },
	{ pattern: 'build/**/*.ts', why: 'the build plugins the SQLite engine and its wasm go through' },
	{
		pattern: 'tsconfig*.json',
		why: 'the paths and compiler options the tests are transformed with',
	},
	{ pattern: 'package.json', why: 'the dependencies and their versions' },
	{ pattern: 'package-lock.json', why: 'the installed dependencies' },
]

/**
 * A module specifier of an import or re-export (static or dynamic), or of a require call: `require`, a function made by
 * `createRequire` and named after it (`localRequire`), and `require.resolve`.
 */
export const IMPORT_SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\b\w*[Rr]equire(?:\.resolve)?\s*\(\s*)['"]([^'"]+)['"]/g

/** An import or re-export of types only: erased at runtime, the type-check covers it. */
export const TYPE_ONLY_IMPORT =
	/^\s*(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s*from\s*['"][^'"]+['"]/gm

/** The variables a git hook exports, which would point git at the repository being committed instead of `root`. */
export const GIT_HOOK_VARIABLES: readonly string[] = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']

/** A file started by its address (a worker, a fixture page): `new URL('./file', import.meta.url)`. */
export const URL_SPECIFIER =
	/\bnew\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g

/** The query of a specifier (`?worker&url`, `?raw`): the file is the part before it. */
export const SPECIFIER_QUERY = /\?.*$/

/** The source alias: `@/x` is `src/x`. */
export const SOURCE_ALIAS = { prefix: '@/', folder: 'src/' } as const

/** The extensions an import without one resolves to, in vite's order. */
export const RESOLVED_SUFFIXES: readonly string[] = [
	'',
	'.ts',
	'.tsx',
	'.js',
	'/index.ts',
	'/index.js',
]

/** The files the scanner reads for edges: the others (data, XML) are reached, never read. */
export const SCANNED_EXTENSIONS = /\.(?:ts|tsx|js|mjs|cjs)$/
