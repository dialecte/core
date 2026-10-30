import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { BROWSER_ONLY_XML_APIS } from './test-entry-environment.constants'

import { describe, expect, it } from 'vitest'

/**
 * The source files of the test entry: every `.ts` file under its folder, tests excluded, and the list of
 * banned APIs, which names them.
 */
function listTestEntrySources(params: { folder: string }): string[] {
	const { folder } = params
	const entries = readdirSync(folder, { recursive: true, encoding: 'utf8' })
	return entries
		.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
		.filter((entry) => entry !== 'test-entry-environment.constants.ts')
		.map((entry) => `${folder}/${entry}`)
}

/** The browser-only XML APIs a source uses. */
function findBrowserOnlyXmlApis(params: { source: string }): string[] {
	const { source } = params
	return BROWSER_ONLY_XML_APIS.filter((api) => api.pattern.test(source)).map((api) => api.name)
}

describe('the test entry reads XML the same way in every environment', () => {
	const folder = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

	it('no source of the test entry uses a browser-only XML API', () => {
		const offenders = listTestEntrySources({ folder }).flatMap(function apisOf(path) {
			const apis = findBrowserOnlyXmlApis({ source: readFileSync(path, 'utf8') })
			return apis.map((api) => `${path.slice(folder.length + 1)}: ${api}`)
		})
		expect(offenders).toEqual([])
	})

	it('the check sees each API it bans', () => {
		const found = BROWSER_ONLY_XML_APIS.map((api) => findBrowserOnlyXmlApis({ source: api.sample }))
		expect(found).toEqual(BROWSER_ONLY_XML_APIS.map((api) => [api.name]))
	})

	it('a DOM library, read through its namespace import, is not a browser global', () => {
		const source = 'new lib.DOMParser().parseFromString(xml, type); new lib.XMLSerializer()'
		expect(findBrowserOnlyXmlApis({ source })).toEqual([])
	})
})
