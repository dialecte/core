import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEachPatternMatches } from './assert-each-pattern-matches'
import { NON_IMPORT_EDGES, PACKAGE_ROOT, STORE_TEST_FILE_PATTERNS } from './test-scope.constants'

import { afterEach, describe, expect, it } from 'vitest'

describe('assertEachPatternMatches', () => {
	let root: string | undefined

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true })
		root = undefined
	})

	function makeRoot(): string {
		const made = mkdtempSync(join(tmpdir(), 'test-scope-patterns-'))
		mkdirSync(join(made, 'build'))
		writeFileSync(join(made, 'build/plugin.ts'), '')
		writeFileSync(join(made, 'package.json'), '{}')
		root = made
		return made
	}

	it('a pattern naming no file fails, the owner and every unmatched pattern in the message', () => {
		const made = makeRoot()
		expect(() =>
			assertEachPatternMatches({
				root: made,
				patterns: ['package.json', 'vite.engine.config.ts', 'build/**/*.ts', 'gone/**'],
				owner: 'the non-import edges',
			}),
		).toThrow(/the non-import edges.*vite\.engine\.config\.ts, gone\/\*\*/)
	})

	it('every pattern naming a file passes', () => {
		const made = makeRoot()
		expect(
			assertEachPatternMatches({
				root: made,
				patterns: ['package.json', 'build/**/*.ts'],
				owner: 'the non-import edges',
			}),
		).toBeUndefined()
	})

	it('every non-import edge and store test pattern of the package names a file of it', () => {
		expect(
			assertEachPatternMatches({
				root: PACKAGE_ROOT,
				patterns: [...NON_IMPORT_EDGES.map((edge) => edge.pattern), ...STORE_TEST_FILE_PATTERNS],
				owner: 'the test scope',
			}),
		).toBeUndefined()
	})
})
