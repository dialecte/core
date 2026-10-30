import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCE_SCAN_TIMEOUT_MS } from './test-timing.constants'

import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE_ROOT = join(PACKAGE_ROOT, 'src')

// written in pieces: this file must not hold the module names it bans
const RETIRED_MODULES = [['@xmldom', 'xmldom'].join('/'), ['x', 'path'].join('')]
const DOM_FOLDER = ['xml', 'dom'].join('-')
const IMPORT_OF_RETIRED_MODULE = new RegExp(
	`(?:from|import\\(|require\\()\\s*['"](?:${RETIRED_MODULES.map((name) => name.replace('/', '\\/')).join('|')})(?:/[^'"]*)?['"]`,
)
const IMPORT_OF_DOM_FOLDER = new RegExp(
	`(?:from|import\\()\\s*['"][^'"]*/${DOM_FOLDER}(?:/[^'"]*)?['"]`,
)

function listSourceFiles(folder: string): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap(function expand(entry) {
		const path = join(folder, entry.name)
		if (entry.isDirectory()) return listSourceFiles(path)
		return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : []
	})
}

describe('the test entry reads XML through one engine', () => {
	it('package.json → neither the pure-JS DOM nor the second XPath engine is a dependency', () => {
		const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
			string,
			Record<string, string> | undefined
		>
		const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
			.flatMap((section) => Object.keys(manifest[section] ?? {}))
			.filter((name) => RETIRED_MODULES.includes(name))
		expect(declared).toEqual([])
	})

	it('package.json → libxml2-wasm is pinned exactly, and sax stays', () => {
		const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
			dependencies: Record<string, string>
		}
		expect(manifest.dependencies['libxml2-wasm']).toBe('0.7.2')
		expect(manifest.dependencies.sax).toBeDefined()
	})

	it(
		'the sources of src/ → none imports a retired module or the retired xml-dom folder',
		() => {
			const offenders = listSourceFiles(SOURCE_ROOT)
				.filter((file) => {
					const source = readFileSync(file, 'utf8')
					return IMPORT_OF_RETIRED_MODULE.test(source) || IMPORT_OF_DOM_FOLDER.test(source)
				})
				.map((file) => relative(SOURCE_ROOT, file))
			expect(offenders).toEqual([])
		},
		SOURCE_SCAN_TIMEOUT_MS,
	)

	it('src/test → the retired xml-dom folder is gone', () => {
		const folders = readdirSync(join(SOURCE_ROOT, 'test'), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
		expect(folders).not.toContain(DOM_FOLDER)
	})
})
