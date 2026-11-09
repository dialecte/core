import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { importClosureOf } from './import-closure'

import { afterEach, describe, expect, it } from 'vitest'

type ClosureCase = {
	/** The package's files, path from its root to content. */
	files: Record<string, string>
	start: string[]
	/** Exactly the files the start reaches, the start included. */
	reached: string[]
}

const CASES: Record<string, ClosureCase> = {
	'a relative import without extension reaches its .ts file, and what that file imports': {
		files: {
			'src/a.test.ts': "import { b } from './b'",
			'src/b.ts': "import { c } from './c'\nexport const b = c",
			'src/c.ts': 'export const c = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/b.ts', 'src/c.ts'],
	},
	'a folder import reaches its index.ts': {
		files: {
			'src/a.test.ts': "import { b } from './b'",
			'src/b/index.ts': 'export const b = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/b/index.ts'],
	},
	'`@/` is the src folder, wherever the importer lives': {
		files: {
			'src/deep/folder/a.test.ts': "import { errors } from '@/errors'",
			'src/errors/index.ts': 'export const errors = 1',
		},
		start: ['src/deep/folder/a.test.ts'],
		reached: ['src/deep/folder/a.test.ts', 'src/errors/index.ts'],
	},
	'a query after the specifier (`?worker&url`, `?raw`) names the file before it': {
		files: {
			'src/a.test.ts':
				"import engineUrl from './engine.worker.ts?worker&url'\nimport text from './data.xml?raw'",
			'src/engine.worker.ts': "import { b } from './b'",
			'src/b.ts': 'export const b = 1',
			'src/data.xml': '<a/>',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/engine.worker.ts', 'src/b.ts', 'src/data.xml'],
	},
	'a file started by its address (`new URL(..., import.meta.url)`) is reached, and what it imports':
		{
			files: {
				'src/a.test.ts':
					"const url = new URL('./hub.worker.ts', import.meta.url)\nconst page = new URL( '../pages/frame.ts' , import.meta.url )",
				'src/hub.worker.ts': "import { b } from './b'",
				'src/b.ts': 'export const b = 1',
				'pages/frame.ts': 'export const frame = 1',
			},
			start: ['src/a.test.ts'],
			reached: ['src/a.test.ts', 'src/hub.worker.ts', 'src/b.ts', 'pages/frame.ts'],
		},
	'an import of types only, a re-export of types only and a default type import are not followed': {
		files: {
			'src/a.test.ts': [
				"import type { A } from './a.types'",
				"import type {\n\tB,\n\tC,\n} from './b.types'",
				"import type D from './d.types'",
				"export type { E } from './e.types'",
				"export type * from './f.types'",
				"import { g } from './g'",
			].join('\n'),
			'src/a.types.ts': "import { x } from './x'",
			'src/b.types.ts': 'export type B = 1',
			'src/d.types.ts': 'export type D = 1',
			'src/e.types.ts': 'export type E = 1',
			'src/f.types.ts': 'export type F = 1',
			'src/g.ts': 'export const g = 1',
			'src/x.ts': 'export const x = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/g.ts'],
	},
	'a type alias declared before a runtime import does not hide that import': {
		files: {
			'src/a.test.ts': [
				"import type { A } from './a.types'",
				'export type Local = { from: string }',
				"import { g } from './g'",
			].join('\n'),
			'src/a.types.ts': 'export type A = 1',
			'src/g.ts': 'export const g = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/g.ts'],
	},
	'a re-export of values, a dynamic import and a require are followed': {
		files: {
			'src/a.test.ts': [
				"export * from './b'",
				"export { c } from './c'",
				"const d = await import('./d')",
				"const e = require('./e')",
			].join('\n'),
			'src/b.ts': 'export const b = 1',
			'src/c.ts': 'export const c = 1',
			'src/d.ts': 'export const d = 1',
			'src/e.ts': 'export const e = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
	},
	'a side-effect import, an import mixing types and values, `require.resolve` and a `createRequire` function are followed':
		{
			files: {
				'src/a.test.ts': [
					"import './setup'",
					"import { type A, b } from './b'",
					"const path = require.resolve('./c')",
					'const localRequire = createRequire(import.meta.url)',
					"const d = localRequire('./d')",
				].join('\n'),
				'src/setup.ts': 'globalThis.ready = true',
				'src/b.ts': 'export type A = 1\nexport const b = 1',
				'src/c.ts': 'export const c = 1',
				'src/d.ts': 'export const d = 1',
			},
			start: ['src/a.test.ts'],
			reached: ['src/a.test.ts', 'src/setup.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
		},
	'a namespace re-export of types only is not followed': {
		files: {
			'src/a.test.ts': "export type * as types from './a.types'\nexport * as values from './b'",
			'src/a.types.ts': 'export type A = 1',
			'src/b.ts': 'export const b = 1',
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/b.ts'],
	},
	'a package import and an import naming no file reach nothing; a cycle ends': {
		files: {
			'src/a.test.ts':
				"import { describe } from 'vitest'\nimport { gone } from './gone'\nimport { b } from './b'",
			'src/b.ts': "import { a } from './c'",
			'src/c.ts': "import { b } from './b'",
		},
		start: ['src/a.test.ts'],
		reached: ['src/a.test.ts', 'src/b.ts', 'src/c.ts'],
	},
	'several start files: the union of what each reaches': {
		files: {
			'src/a.test.ts': "import { b } from './b'",
			'src/c.test.ts': "import { d } from './d'",
			'src/b.ts': 'export const b = 1',
			'src/d.ts': 'export const d = 1',
			'src/e.ts': 'export const e = 1',
		},
		start: ['src/a.test.ts', 'src/c.test.ts'],
		reached: ['src/a.test.ts', 'src/b.ts', 'src/c.test.ts', 'src/d.ts'],
	},
}

describe('importClosureOf', () => {
	let root: string | undefined

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true })
		root = undefined
	})

	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			root = mkdtempSync(join(tmpdir(), 'test-scope-closure-'))
			for (const [path, content] of Object.entries(testCase.files)) {
				mkdirSync(dirname(join(root, path)), { recursive: true })
				writeFileSync(join(root, path), content)
			}
			expect(importClosureOf({ root, files: testCase.start })).toEqual(new Set(testCase.reached))
		})
	}
})
