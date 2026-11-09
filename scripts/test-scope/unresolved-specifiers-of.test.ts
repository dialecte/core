import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { browserTierOf } from './browser-tier-of'
import { KNOWN_UNRESOLVED_SPECIFIERS, PACKAGE_ROOT } from './test-scope.constants'
import { BROWSER_FILES } from './test-scope.fixtures'
import { unresolvedSpecifiersOf } from './unresolved-specifiers-of'

import { afterEach, describe, expect, it } from 'vitest'

import type { UnresolvedSpecifier } from './test-scope.types'

/** How long the package case may take: it reads the closure of every store test file. */
const PACKAGE_SCAN_TIMEOUT_MS = 30_000

type UnresolvedCase = {
	files: Record<string, string>
	start: string[]
	unresolved: UnresolvedSpecifier[]
}

const CASES: Record<string, UnresolvedCase> = {
	'a relative import, an `@/` import and an address naming no file are reported; packages and resolved files are not':
		{
			files: {
				'src/a.test.ts': [
					"import { describe } from 'vitest'",
					"import { b } from './b'",
					"import { gone } from './gone'",
					"import { alias } from '@/missing/alias'",
					"const url = new URL('./missing.worker.ts', import.meta.url)",
				].join('\n'),
				'src/b.ts': 'export const b = 1',
			},
			start: ['src/a.test.ts'],
			unresolved: [
				{ from: 'src/a.test.ts', specifier: './gone' },
				{ from: 'src/a.test.ts', specifier: './missing.worker.ts' },
				{ from: 'src/a.test.ts', specifier: '@/missing/alias' },
			],
		},
	'a `.js` suffix on a `.ts` module is reported: the closure does not map it': {
		files: {
			'src/a.test.ts': "import { b } from './b.js'",
			'src/b.ts': 'export const b = 1',
		},
		start: ['src/a.test.ts'],
		unresolved: [{ from: 'src/a.test.ts', specifier: './b.js' }],
	},
	'files reached through the closure are read too; files outside it and type-only imports are not':
		{
			files: {
				'src/a.test.ts': "import type { T } from './types-gone'\nimport { b } from './b'",
				'src/b.ts': "import { c } from './c-gone'",
				'src/outside.ts': "import { d } from './d-gone'",
			},
			start: ['src/a.test.ts'],
			unresolved: [{ from: 'src/b.ts', specifier: './c-gone' }],
		},
}

describe('unresolvedSpecifiersOf', () => {
	let root: string | undefined

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true })
		root = undefined
	})

	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			root = mkdtempSync(join(tmpdir(), 'test-scope-unresolved-'))
			for (const [path, content] of Object.entries(testCase.files)) {
				mkdirSync(dirname(join(root, path)), { recursive: true })
				writeFileSync(join(root, path), content)
			}
			expect(unresolvedSpecifiersOf({ root, files: testCase.start })).toEqual(testCase.unresolved)
		})
	}

	it(
		"the store tests' closures name no file only where the package says so",
		() => {
			expect(
				unresolvedSpecifiersOf({
					root: PACKAGE_ROOT,
					files: BROWSER_FILES.filter((path) => browserTierOf({ path }) === 'T4'),
				}),
			).toEqual(KNOWN_UNRESOLVED_SPECIFIERS.map(({ from, specifier }) => ({ from, specifier })))
		},
		PACKAGE_SCAN_TIMEOUT_MS,
	)
})
