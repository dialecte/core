import { describe, expect, it } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

/**
 * Validation reads records, never a DOM, a window or a store: the same code runs in the page, a worker and Node.
 * Comments and string contents are dropped before the scan (except where a pattern reads an import path), so prose
 * and messages may name what code may not.
 *
 * Limits: imports are caught where written (`from '...'`, `import('...')`), not through a re-export of another
 * module. Every source under `src/validation` is scanned, test helpers (`conformance/`) included: they reach test
 * utilities through `@/test`, never a store module directly. `Document` is also core's dialecte class and is not
 * banned; `Element`, `Node` and `NodeList` are banned in type position (annotation, cast, union, array, generic
 * argument, alias) and after `instanceof` only. A template literal is one string (what is inside `${...}` is not
 * scanned). A regular expression literal is read after `(,=:[!&|?{};` or `return`. A `document` followed by a colon
 * (a parameter or property name) and a name in a plain brace list of names (`const { document } = x`, `f({ document })`)
 * are left alone.
 */
const DIALECTE_DOCUMENT_MEMBERS =
	'query|transaction|prepare|subscribe|state|perf|documentId|close|destroy|channelName'

type Forbidden = {
	readonly token: string
	readonly pattern: RegExp
	/** Whether the pattern reads import paths: it scans the code with its strings kept. */
	readonly readsStrings?: true
}

const FORBIDDEN: readonly Forbidden[] = [
	{ token: 'DOM API', pattern: /\b(DOMParser|XMLSerializer|XMLDocument|HTMLElement)\b/ },
	{
		token: 'DOM type',
		pattern:
			/(?::|\bas\b|\bextends\b|\bimplements\b|\binstanceof\b|[|&=])\s*(?:Element|Node|NodeList)\b(?!\s*\.)|\b(?:Element|Node|NodeList)\s*(?:\[\s*\]|[|&])|<\s*(?:Element|Node|NodeList)\s*[>,|]/,
	},
	{
		token: 'DOM query',
		pattern: /\b(querySelector(All)?|getElementsByTagName(NS)?|getElementById)\b/,
	},
	{ token: 'window', pattern: /\bwindow\b/ },
	{ token: 'document global', pattern: /\b(globalThis|self)\s*\.\s*document\b/ },
	{
		// any `document` that is not a member (`record.document`) and not a dialecte document read through its members
		token: 'document global',
		pattern: new RegExp(
			String.raw`(?<![.\w$])document\b(?!\s*\??\.\s*(?:${DIALECTE_DOCUMENT_MEMBERS})\b)(?!\s*:(?!:))`,
		),
	},
	{
		token: 'store module',
		pattern:
			/(\bfrom|\bimport\s*\(|\bimport)\s*['"](dexie|@\/store(\/[^'"]*)?|[^'"]*\/store(\/[^'"]*)?)['"]/,
		readsStrings: true,
	},
]

/** Whether a `/` after this code opens a regular expression literal (not a division). */
function startsRegex(code: string): boolean {
	const before = code.trimEnd()
	return before === '' || /[(,=:[!&|?{};]$/.test(before) || /\breturn$/.test(before)
}

/** A plain brace list of names (destructuring, shorthand properties) names nothing it reads: emptied. */
function withoutNameLists(code: string): string {
	return code.replace(/\{\s*[\w$]+(?:\s*,\s*[\w$]+)*\s*,?\s*\}/g, '{}')
}

/** The source without its comments, and without the contents of its strings unless asked to keep them. */
function strip(params: { source: string; keepStrings: boolean }): string {
	const { source, keepStrings } = params
	let out = ''
	let index = 0
	while (index < source.length) {
		const char = source[index]
		const next = source[index + 1]
		if (char === '/' && next === '/') {
			while (index < source.length && source[index] !== '\n') index++
		} else if (char === '/' && next === '*') {
			const end = source.indexOf('*/', index + 2)
			index = end === -1 ? source.length : end + 2
		} else if (char === '/' && startsRegex(out)) {
			let end = index + 1
			let inClass = false
			while (end < source.length && (inClass || source[end] !== '/')) {
				if (source[end] === '\\') end++
				else if (source[end] === '[') inClass = true
				else if (source[end] === ']') inClass = false
				end++
			}
			out += '/ /'
			index = end + 1
		} else if (char === "'" || char === '"' || char === '`') {
			let end = index + 1
			while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1
			out += keepStrings ? source.slice(index, end + 1) : `${char}${char}`
			index = end + 1
		} else {
			out += char
			index++
		}
	}
	return out
}

function forbiddenTokens(source: string): string[] {
	const code = withoutNameLists(strip({ source, keepStrings: false }))
	const codeWithStrings = strip({ source, keepStrings: true })
	return [
		...new Set(
			FORBIDDEN.filter(({ pattern, readsStrings }) =>
				pattern.test(readsStrings ? codeWithStrings : code),
			).map(({ token }) => token),
		),
	]
}

const SOURCES = import.meta.glob<string>(
	['/src/validation/**/*.ts', '!/src/validation/**/*.test.ts'],
	{
		query: '?raw',
		import: 'default',
		eager: true,
	},
)

describe('the dom-free guard - what it catches', () => {
	type TestCase = BaseTestCase & { source: string; tokens: string[] }

	const testCases: Record<string, TestCase> = {
		'new DOMParser() → DOM API': { source: 'new DOMParser()', tokens: ['DOM API'] },
		'new XMLSerializer() → DOM API': { source: 'new XMLSerializer()', tokens: ['DOM API'] },
		'an XMLDocument parameter → DOM API': {
			source: 'function f(doc: XMLDocument) {}',
			tokens: ['DOM API'],
		},
		'element.querySelector(…) → DOM query': {
			source: "element.querySelector('a')",
			tokens: ['DOM query'],
		},
		'window.foo → window': { source: 'window.foo', tokens: ['window'] },
		'document.createElement(…) → document global': {
			source: "document.createElement('a')",
			tokens: ['document global'],
		},
		'document.body → document global': { source: 'document.body', tokens: ['document global'] },
		'document.implementation.createDocument(…) → document global': {
			source: 'document.implementation.createDocument(uri, null, null)',
			tokens: ['document global'],
		},
		'globalThis.document → document global': {
			source: 'globalThis.document',
			tokens: ['document global'],
		},
		"typeof document !== 'undefined' → document global": {
			source: "typeof document !== 'undefined'",
			tokens: ['document global'],
		},
		"an import from '@/store' → store module": {
			source: "import { x } from '@/store'",
			tokens: ['store module'],
		},
		"an import from '@/store/sqlite/engine' → store module": {
			source: "import { x } from '@/store/sqlite/engine'",
			tokens: ['store module'],
		},
		"an import from 'dexie' → store module": {
			source: "import Dexie from 'dexie'",
			tokens: ['store module'],
		},
		'a relative import of a store module → store module': {
			source: "import { x } from '../../store/local/dexie-store'",
			tokens: ['store module'],
		},
		"a dynamic import('@/store/x') → store module": {
			source: "const m = await import('@/store/sqlite/engine')",
			tokens: ['store module'],
		},
		"a dynamic import('../store/x') → store module": {
			source: "const m = await import('../store/local/dexie-store')",
			tokens: ['store module'],
		},
		'a side-effect import of a store module → store module': {
			source: "import '@/store/local'",
			tokens: ['store module'],
		},
		'document?.body → document global': { source: 'document?.body', tokens: ['document global'] },
		"document['body'] → document global": {
			source: "document['body']",
			tokens: ['document global'],
		},
		'document.firstChild → document global': {
			source: 'document.firstChild',
			tokens: ['document global'],
		},
		'document.childNodes → document global': {
			source: 'document.childNodes',
			tokens: ['document global'],
		},
		'document.location → document global': {
			source: 'document.location',
			tokens: ['document global'],
		},
		'document as an argument → document global': {
			source: 'read(document)',
			tokens: ['document global'],
		},
		'document as a value (const d = document) → document global': {
			source: 'const d = document',
			tokens: ['document global'],
		},
		'window.document → window': { source: 'window.document', tokens: ['window'] },
		'an Element parameter → DOM type': {
			source: 'function f(element: Element) {}',
			tokens: ['DOM type'],
		},
		'a Node cast → DOM type': { source: 'const n = x as Node', tokens: ['DOM type'] },
		'a NodeList generic argument → DOM type': {
			source: 'const l: Array<NodeList> = []',
			tokens: ['DOM type'],
		},
		'instanceof Element → DOM type': {
			source: 'if (value instanceof Element) {}',
			tokens: ['DOM type'],
		},
		'a dialecte Document type → nothing': {
			source: 'function f(document: Document) {}',
			tokens: [],
		},
		'an ElementsOf type → nothing': {
			source: 'type T = ElementsOf<Config>',
			tokens: [],
		},
		'document.query → nothing': { source: 'document.query.getRecord(ref)', tokens: [] },
		'a dialecte document (document.query.validate) → nothing': {
			source: 'await document.query.validate.value({ parent, tagName, value })',
			tokens: [],
		},
		'a record property (record.document.createdAt) → nothing': {
			source: 'const id = record.document.createdAt',
			tokens: [],
		},
		'a destructured document (const { document } = params) → nothing': {
			source: 'const { document } = params',
			tokens: [],
		},
		'a shorthand document property (f({ document })) → nothing': {
			source: 'f({ document })',
			tokens: [],
		},
		'a union with Element → DOM type': {
			source: 'function f(value: string | Element) {}',
			tokens: ['DOM type'],
		},
		'an alias of Node → DOM type': { source: 'type T = Node', tokens: ['DOM type'] },
		'an Element array → DOM type': {
			source: 'const list: Element[] = []',
			tokens: ['DOM type'],
		},
		'a regex literal holding a quote, then window → window': {
			source: 'const re = /"/; window.foo',
			tokens: ['window'],
		},
		'a regex literal holding two slashes, then document.body → document global': {
			source: 'const re = /\\/\\//; document.body',
			tokens: ['document global'],
		},
		'the words in a string → nothing': {
			source: "const message = 'the window of document.body, new DOMParser()'",
			tokens: [],
		},
		'a url in a string, then a window → window (the comment stripper is not fooled)': {
			source: "const url = 'http://host/a'; window.foo",
			tokens: ['window'],
		},
		'a slash pair in a string, then document.body → document global': {
			source: "const sep = '//'; document.body",
			tokens: ['document global'],
		},
		'the words in a comment → nothing': {
			source:
				'// the window of the document.body, read from the store\n/* new DOMParser() */ const a = 1',
			tokens: [],
		},
	}

	runTestCases.generic(testCases, (tc) => {
		expect(forbiddenTokens(tc.source)).toEqual(tc.tokens)
	})
})

describe('validation is dom-free', () => {
	it('the scan found sources to read', () => {
		expect(Object.keys(SOURCES).length).toBeGreaterThan(0)
	})

	it('no source under src/validation names a DOM API, the window, the document global or a store module', () => {
		const using = Object.entries(SOURCES)
			.map(([path, source]) => ({ path, tokens: forbiddenTokens(source) }))
			.filter(({ tokens }) => tokens.length > 0)
		expect(using).toEqual([])
	})
})
