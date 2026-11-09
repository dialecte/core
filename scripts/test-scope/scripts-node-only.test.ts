import { globSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { PACKAGE_ROOT, SOURCE_ALIAS } from './test-scope.constants'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Where a file's import points, from the package root: `@/x` is `src/x`, a relative specifier is resolved from the
 * file; a package import points nowhere in the package.
 */
function importTargetOf(params: { file: string; specifier: string }): string | undefined {
	const { file, specifier } = params
	if (specifier.startsWith(SOURCE_ALIAS.prefix))
		return `${SOURCE_ALIAS.folder}${specifier.slice(2)}`
	if (!specifier.startsWith('.')) return undefined
	return relative(PACKAGE_ROOT, join(PACKAGE_ROOT, dirname(file), specifier))
}

describe('the scripts of the package', () => {
	it('import nothing of src/, types included: the node type-check (no DOM) must never reach the library', () => {
		const files = globSync('scripts/**/*.ts', { cwd: PACKAGE_ROOT })
		expect(
			files.flatMap(function sourceImports(file) {
				const text = readFileSync(join(PACKAGE_ROOT, file), 'utf8')
				// the module specifiers TypeScript reads as imports (static, dynamic, type-only, re-exports), never a string's text
				return ts
					.preProcessFile(text, true, true)
					.importedFiles.map((imported) => ({
						specifier: imported.fileName,
						target: importTargetOf({ file, specifier: imported.fileName }),
					}))
					.filter((found) => found.target?.startsWith(SOURCE_ALIAS.folder))
					.map((found) => `${file} imports ${found.specifier}`)
			}),
		).toEqual([])
	})
})
