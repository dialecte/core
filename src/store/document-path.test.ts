import { expectRejectsWith } from './contract/store-contract.fixtures'
import { parseDocumentPath } from './document-path'

import { expect, it } from 'vitest'

import { runTestCases } from '@/test'

import type { DocumentPathParts } from './document-path.types'
import type { BaseTestCase } from '@/test'

type ParsedCase = BaseTestCase & {
	path: string
	expected: DocumentPathParts
}

const parsedCases: Record<string, ParsedCase> = {
	'a folder and a file name → both, in order': {
		path: 'substations/north.scd',
		expected: { folders: ['substations'], fileName: 'north.scd' },
	},
	'a file name alone → no folder, at the root': {
		path: 'north.scd',
		expected: { folders: [], fileName: 'north.scd' },
	},
	'folders with dots and a file name with two → kept as written': {
		path: 'a.b/c/archive.tar.gz',
		expected: { folders: ['a.b', 'c'], fileName: 'archive.tar.gz' },
	},
	'a file name without an extension → a valid form, the extension is the document’s': {
		path: 'notes/README',
		expected: { folders: ['notes'], fileName: 'README' },
	},
	'a file name of 255 bytes → kept': {
		path: `substations/${'a'.repeat(251)}.scd`,
		expected: { folders: ['substations'], fileName: `${'a'.repeat(251)}.scd` },
	},
	'a path of 1024 bytes → kept': {
		path: `${'a/'.repeat(509)}${'b'.repeat(2)}.scd`,
		expected: { folders: Array.from({ length: 509 }, () => 'a'), fileName: 'bb.scd' },
	},
	'a name in NFC with an accent → kept': {
		path: 'postes/Sé.scd',
		expected: { folders: ['postes'], fileName: 'Sé.scd' },
	},
}

runTestCases.generic(parsedCases, (testCase) => {
	expect(parseDocumentPath({ path: testCase.path })).toEqual(testCase.expected)
})

type RefusedCase = BaseTestCase & {
	path: unknown
	/** what the refusal's detail says of the path */
	detail: RegExp
}

const refusedCases: Record<string, RefusedCase> = {
	'a leading separator → refused, a path is relative': {
		path: '/substations/north.scd',
		detail: /an empty folder or file name/,
	},
	'a trailing separator → refused, a path ends with a file name': {
		path: 'substations/',
		detail: /an empty folder or file name/,
	},
	'two separators in a row → refused': {
		path: 'substations//north.scd',
		detail: /an empty folder or file name/,
	},
	'the empty string → refused': {
		path: '',
		detail: /an empty folder or file name/,
	},
	'a folder "." → refused, one spelling per place': {
		path: './north.scd',
		detail: /"\." or "\.\."/,
	},
	'a folder ".." → refused, a path never leaves the project': {
		path: 'substations/../north.scd',
		detail: /"\." or "\.\."/,
	},
	'a backslash → refused, it separates folders on Windows': {
		path: 'substations\\north.scd',
		detail: /a backslash/,
	},
	'a line feed → refused, a control character': {
		path: 'substations/north\n.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a DEL → refused, a control character': {
		path: 'substations/north\u007f.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a control from U+0080-U+009F (U+0085) → refused, a control character': {
		path: 'substations/north\u0085.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a right-to-left override (U+202E) → refused, an invisible format character': {
		path: 'substations/north‮dcs.xml',
		detail: /an invisible format, separator or control character/,
	},
	'a left-to-right isolate (U+2066) → refused, an invisible format character': {
		path: 'substations/⁦north.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a zero-width space (U+200B) → refused, an invisible format character': {
		path: 'substations/no​rth.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a byte order mark (U+FEFF) → refused, an invisible format character': {
		path: '﻿substations/north.scd',
		detail: /an invisible format, separator or control character/,
	},
	'a line separator (U+2028) → refused, a separator character': {
		path: 'substations/north .scd',
		detail: /an invisible format, separator or control character/,
	},
	'a paragraph separator (U+2029) → refused, a separator character': {
		path: 'substations/north .scd',
		detail: /an invisible format, separator or control character/,
	},
	'a lone surrogate → refused, not well-formed': {
		path: 'substations/north\ud800.scd',
		detail: /not well-formed/,
	},
	'an e and a combining acute (NFD) → refused, NFC only': {
		path: 'substations/Sé.scd',
		detail: /NFC/,
	},
	'a file name of 256 bytes → refused, longer than a file system takes': {
		path: `substations/${'a'.repeat(252)}.scd`,
		detail: /more than 255 bytes/,
	},
	'a file name of 129 characters, 127 of them two-byte (256 bytes) → refused, counted in bytes': {
		path: `substations/${'é'.repeat(127)}.s`,
		detail: /more than 255 bytes/,
	},
	'a path of 1025 bytes → refused': {
		path: `${'a/'.repeat(509)}${'b'.repeat(3)}.scd`,
		detail: /more than 1024 bytes/,
	},
	'null → refused, a path is a string': {
		path: null,
		detail: /not a string/,
	},
	'a number → refused, a path is a string': {
		path: 7,
		detail: /not a string/,
	},
}

for (const [description, testCase] of Object.entries(refusedCases)) {
	it(description, async () => {
		await expectRejectsWith({
			action: Promise.resolve().then(function parse() {
				return parseDocumentPath({ path: testCase.path as string })
			}),
			key: 'DOCUMENT_PATH_INVALID',
			meta: { path: testCase.path },
			detail: testCase.detail,
		})
	})
}
