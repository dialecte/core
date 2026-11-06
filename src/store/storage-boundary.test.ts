import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SQLITE_DECLARED_ERROR_CODES, RETIRED_SQLITE_ERROR_KEY } from '../errors/errors.fixtures'
import { SOURCE_SCAN_TIMEOUT_MS } from '../test/test-timing.constants'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Test files and `*.fixtures.ts` files are left out of every scan below: they drive the SQLite store through the
// port to prove what the port promises, and they assert on a store's refusals by key, so they name SQLite and its
// keys by design. The boundary is about what ships: the code that picks a store, opens a project or a document.

const SOURCE_ROOT = join(fileURLToPath(new URL('../', import.meta.url)))
const SQLITE_FOLDER = `store${sep}sqlite`

/** The folders and files that must hold nothing of SQLite: the code that picks a store and what runs on the port. */
const STORE_AGNOSTIC_FOLDERS = ['dialecte', 'project', 'document']
const STORE_AGNOSTIC_FILES = ['store/resolve-store.ts', 'test/test-storage/test-store-for.ts']
/** The files that must not even name SQLite: the picking of a store is a registry lookup. */
const SQLITE_FREE_FILES = ['store/resolve-store.ts', 'test/test-storage/test-store-for.ts']

/** What only the SQLite side names: its folder and its two entries. */
function isSqliteSide(params: { file: string }): boolean {
	const { file } = params
	return (
		file.startsWith(`${SQLITE_FOLDER}${sep}`) || file === 'sqlite.ts' || file === 'sqlite-engine.ts'
	)
}

/** An import target on the SQLite side: its folder, and the two entries `@/sqlite` and `@/sqlite-engine`. */
function isSqliteTarget(path: string): boolean {
	return (
		path === SQLITE_FOLDER ||
		path.startsWith(`${SQLITE_FOLDER}${sep}`) ||
		path === 'sqlite' ||
		path === 'sqlite-engine'
	)
}

function isTestOrFixture(params: { file: string }): boolean {
	return /\.(test|fixtures)(\.[\w-]+)?\.(ts|tsx)$/.test(params.file)
}

/** Every `.ts` file under `folder`, relative to the source root, tests and fixtures left out. */
function listShippedFiles(params: { folder: string }): string[] {
	return readdirSync(params.folder, { withFileTypes: true }).flatMap(function expand(entry) {
		const path = join(params.folder, entry.name)
		if (entry.isDirectory()) return listShippedFiles({ folder: path })
		const file = relative(SOURCE_ROOT, path)
		return /\.tsx?$/.test(entry.name) && !isTestOrFixture({ file }) ? [file] : []
	})
}

function textOf(params: { file: string }): string {
	return readFileSync(join(SOURCE_ROOT, params.file), 'utf8')
}

function storeAgnosticFiles(): string[] {
	return [
		...STORE_AGNOSTIC_FILES,
		...STORE_AGNOSTIC_FOLDERS.flatMap(function filesOf(folder) {
			return listShippedFiles({ folder: join(SOURCE_ROOT, folder) })
		}),
	]
}

/** The module specifiers a file imports (static, dynamic, `export ... from`), resolved to a path relative to the source root. */
function importedPathsOf(params: { file: string }): string[] {
	const { file } = params
	const source = ts.createSourceFile(file, textOf({ file }), ts.ScriptTarget.Latest, true)
	const specifiers: string[] = []
	function visit(node: ts.Node): void {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			specifiers.push(node.moduleSpecifier.text)
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			specifiers.push(node.arguments[0].text)
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return specifiers.flatMap(function resolved(specifier) {
		if (specifier.startsWith('@/')) return [specifier.slice(2).split('/').join(sep)]
		if (specifier.startsWith('.')) {
			return [relative(SOURCE_ROOT, resolve(dirname(join(SOURCE_ROOT, file)), specifier))]
		}
		return []
	})
}

/** The identifiers and the string literals of a file that hold `sqlite`: comments are not code, they are not read. */
function sqliteNamesOf(params: { file: string }): string[] {
	const { file } = params
	const source = ts.createSourceFile(file, textOf({ file }), ts.ScriptTarget.Latest, true)
	const names: string[] = []
	function visit(node: ts.Node): void {
		const isName =
			ts.isIdentifier(node) ||
			ts.isStringLiteralLike(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		if (isName && /sqlite/i.test(node.text)) names.push(node.text)
		ts.forEachChild(node, visit)
	}
	visit(source)
	return names
}

/** Each file of `files` holding a match of `pattern` anywhere in its text, comments included, with what matched. */
function tokensIn(params: { files: string[]; pattern: RegExp }): string[] {
	const { files, pattern } = params
	return files.flatMap(function matches(file) {
		const found = textOf({ file }).match(pattern) ?? []
		return [...new Set(found)].map((token) => `${file}: ${token}`)
	})
}

describe('the store boundary: what picks a store, opens a project or a document names no SQLite', () => {
	it(
		'resolve-store, the test store helper, dialecte/, project/ and document/ → import nothing under store/sqlite/ nor the entries sqlite and sqlite-engine',
		() => {
			const importingSqlite = storeAgnosticFiles().flatMap(function importsOf(file) {
				return importedPathsOf({ file })
					.filter(isSqliteTarget)
					.map((path) => `${file} → ${path}`)
			})
			expect(importingSqlite).toEqual([])
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)

	it(
		'the same files → name no engine-lost token: what a store lost is its connection',
		() => {
			const naming = tokensIn({
				files: storeAgnosticFiles(),
				pattern: /\w*(?:ENGINE_LOST|EngineLost)\w*/g,
			})
			expect(naming).toEqual([])
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)

	it(
		'resolve-store and the test store helper → no identifier and no string literal holds sqlite: a kind is looked up by its type',
		() => {
			const naming = SQLITE_FREE_FILES.flatMap(function namesOf(file) {
				return sqliteNamesOf({ file }).map((name) => `${file}: ${name}`)
			})
			expect(naming).toEqual([])
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)

	it(
		'no file outside the SQLite side → names a key SQLite alone raises, STORE_ENGINE_LOST or PROJECT_SQLITE_NOT_IMPORTED',
		() => {
			const keys = [
				...Object.keys(SQLITE_DECLARED_ERROR_CODES),
				'STORE_ENGINE_LOST',
				RETIRED_SQLITE_ERROR_KEY,
			]
			const files = listShippedFiles({ folder: SOURCE_ROOT }).filter(
				(file) => !isSqliteSide({ file }),
			)
			const naming = tokensIn({ files, pattern: new RegExp(`\\b(?:${keys.join('|')})\\b`, 'g') })
			expect(naming).toEqual([])
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)
})
