import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCE_SCAN_TIMEOUT_MS } from '../test-timing.constants'

import { describe, expect, it } from 'vitest'

describe('the engine import', () => {
	const SOURCE_ROOT = join(fileURLToPath(new URL('../../', import.meta.url)))
	const SEAM_FOLDER = `test${sep}xml${sep}`
	const ENGINE = ['libxml2', 'wasm'].join('-')
	const IMPORT_OF_ENGINE = new RegExp(
		`(?:from|import\\(|require\\()\\s*['"]${ENGINE}(?:/[^'"]*)?['"]`,
	)
	// the text between `import` and `from` holds no quote, so one match is one import statement
	const VALUE_IMPORT_OF_ENGINE = new RegExp(
		`^import\\s+(?!type\\b)[^'"]*?from\\s+['"]${ENGINE}(?:/[^'"]*)?['"]`,
		'm',
	)

	function listSourceFiles(folder: string): string[] {
		return readdirSync(folder, { withFileTypes: true }).flatMap(function expand(entry) {
			const path = join(folder, entry.name)
			if (entry.isDirectory()) return listSourceFiles(path)
			return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : []
		})
	}

	it(
		'the sources of src/ → only the seam imports the engine, and it does',
		() => {
			const sourceFiles = listSourceFiles(SOURCE_ROOT)
			const importers = sourceFiles
				.filter((file) => IMPORT_OF_ENGINE.test(readFileSync(file, 'utf8')))
				.map((file) => relative(SOURCE_ROOT, file))
			const seamFilesWithValueImport = listSourceFiles(join(SOURCE_ROOT, 'test', 'xml'))
				.filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.script.ts'))
				.filter((file) => VALUE_IMPORT_OF_ENGINE.test(readFileSync(file, 'utf8')))
			expect({
				outside: importers.filter((file) => !file.startsWith(SEAM_FOLDER)),
				seamOpensDocuments: seamFilesWithValueImport.length > 0,
			}).toEqual({ outside: [], seamOpensDocuments: true })
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)
})
