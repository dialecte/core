import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const FOLDER = fileURLToPath(new URL('.', import.meta.url))

/** The import declarations of a source: one statement at a time, whatever its quotes and lines. */
const IMPORT_STATEMENT =
	/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/gm

function importedModules(source: string): string[] {
	return Array.from(source.matchAll(IMPORT_STATEMENT), (match) => match[1] ?? match[2] ?? '')
}

describe('the shape check reads XML through the XML seam', () => {
	const sources = readdirSync(FOLDER)
		.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
		.map((name) => ({ name, modules: importedModules(readFileSync(join(FOLDER, name), 'utf8')) }))

	it('the shape check opens its documents through the seam', () => {
		const seamImporters = sources
			.filter(({ modules }) =>
				modules.some((module) => /(^|\/)xml$/.test(module) || /(^|\/)xml\/index$/.test(module)),
			)
			.map(({ name }) => name)
		expect(seamImporters).toContain('assert-valid-xml.ts')
	})
})
