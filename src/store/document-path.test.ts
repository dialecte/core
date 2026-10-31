import { expectRejectsWith } from './contract/store-contract.fixtures'
import {
	applyDocumentUpdates,
	assertDocumentPath,
	assertDocumentPlace,
	parseDocumentPath,
	pathHolderOf,
	splitFileName,
} from './document-path'

import { expect, it } from 'vitest'

import { runTestCases } from '@/test'

import type { DocumentPathParts } from './document-path.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'
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

type SplitCase = BaseTestCase & {
	path: string
	expected: { name: string; extension: string }
}

const splitCases: Record<string, SplitCase> = {
	'a file name with one dot → the name and the extension at that dot': {
		path: 'substations/north.scd',
		expected: { name: 'north', extension: '.scd' },
	},
	'a file name with two dots → split at the last': {
		path: 'archive.tar.gz',
		expected: { name: 'archive.tar', extension: '.gz' },
	},
}

runTestCases.generic(splitCases, (testCase) => {
	expect(splitFileName({ path: testCase.path })).toEqual(testCase.expected)
})

it('splitFileName: an extension in capitals, the config reading it in lower case → taken as written', () => {
	expect(splitFileName({ path: 'a/north.SCD', extensions: ['.scd', '.icd'] })).toEqual({
		name: 'north',
		extension: '.SCD',
	})
})

it('splitFileName: an extension the config does not read → refused, the extensions named', async () => {
	await expectRejectsWith({
		action: Promise.resolve().then(function split() {
			return splitFileName({ path: 'a/north.xml', extensions: ['.scd', '.icd'] })
		}),
		key: 'DOCUMENT_PATH_INVALID',
		meta: { path: 'a/north.xml' },
		detail: /not one the document's config reads \(\.scd, \.icd\)/,
	})
})

const unsplitCases: Record<string, RefusedCase> = {
	'a file name without a dot → refused, no extension to take': {
		path: 'notes/README',
		detail: /no extension/,
	},
	'a file name ending with a dot → refused, an empty extension': {
		path: 'notes/north.',
		detail: /no extension/,
	},
	'a file name starting with its only dot → refused, an empty name': {
		path: 'notes/.scd',
		detail: /no extension/,
	},
	'a path breaking a rule → refused for that rule first': {
		path: 'notes//north.scd',
		detail: /an empty folder or file name/,
	},
}

for (const [description, testCase] of Object.entries(unsplitCases)) {
	it(`splitFileName: ${description}`, async () => {
		await expectRejectsWith({
			action: Promise.resolve().then(function split() {
				return splitFileName({ path: testCase.path as string })
			}),
			key: 'DOCUMENT_PATH_INVALID',
			meta: { path: testCase.path },
			detail: testCase.detail,
		})
	})
}

const DOCUMENT: DocumentRecord = {
	id: 'doc-1',
	name: 'north',
	extension: '.scd',
	configKey: 'scl',
	createdAt: 0,
	status: 'ready',
}

type AssertCase = BaseTestCase & {
	document: Partial<DocumentRecord>
	/** the refusal's detail; none when the document passes */
	refused?: RegExp
}

const assertCases: Record<string, AssertCase> = {
	'no path → passes, the document has no place yet': { document: {} },
	'a path ending with its name and extension → passes': { document: { path: 'a/north.scd' } },
	'a path ending with another name → refused': {
		document: { path: 'a/south.scd' },
		refused: /does not end with the document's file name "north\.scd"/,
	},
	'a path ending with another extension → refused': {
		document: { path: 'a/north.icd' },
		refused: /does not end with the document's file name "north\.scd"/,
	},
	'an extension with two dots, the path ending with it → passes': {
		document: { name: 'north', extension: '.tar.gz', path: 'a/north.tar.gz' },
	},
	'an extension without a dot, the path ending with it → passes': {
		document: { name: 'north', extension: 'scd', path: 'a/northscd' },
	},
	'an empty name → refused, a file name holds a name': {
		document: { name: '', path: 'a/.scd' },
		refused: /does not end with the document's file name/,
	},
	'a name that is a number, the path ending with it → refused, a name is a string': {
		document: { name: 7 as unknown as string, path: 'a/7.scd' },
		refused: /a name and an extension that are strings/,
	},
	'a name that is null → refused, a name is a string': {
		document: { name: null as unknown as string, path: 'a/null.scd' },
		refused: /a name and an extension that are strings/,
	},
	'an extension that is null → refused, an extension is a string': {
		document: { extension: null as unknown as string, path: 'a/northnull' },
		refused: /a name and an extension that are strings/,
	},
	'a path breaking a rule → refused for that rule': {
		document: { path: '/a/north.scd' },
		refused: /an empty folder or file name/,
	},
}

for (const [description, testCase] of Object.entries(assertCases)) {
	it(`assertDocumentPath: ${description}`, async () => {
		const document = { ...DOCUMENT, ...testCase.document }
		const check = Promise.resolve().then(function assertPath() {
			assertDocumentPath({ document })
		})
		if (!testCase.refused) return expect(check).resolves.toBeUndefined()
		await expectRejectsWith({
			action: check,
			key: 'DOCUMENT_PATH_INVALID',
			meta: { path: document.path },
			detail: testCase.refused,
		})
	})
}

type HolderCase = BaseTestCase & {
	path: string
	documents: Pick<DocumentRecord, 'id' | 'path'>[]
	/** the document asking: never its own holder */
	documentId?: string
	expected: string | undefined
}

const holderCases: Record<string, HolderCase> = {
	'no document at the place → none': {
		path: 'a/north.scd',
		documents: [{ id: 'd1', path: 'a/south.scd' }],
		expected: undefined,
	},
	'a document at the place → it': {
		path: 'a/north.scd',
		documents: [{ id: 'd1', path: 'a/north.scd' }],
		expected: 'd1',
	},
	'a document whose file is a folder of the place → it': {
		path: 'a/north.scd/x.scd',
		documents: [{ id: 'd1', path: 'a/north.scd' }],
		expected: 'd1',
	},
	'a document under the place as a folder → it': {
		path: 'a/north.scd',
		documents: [{ id: 'd1', path: 'a/north.scd/x.scd' }],
		expected: 'd1',
	},
	'a sibling sharing a prefix but not a folder → none': {
		path: 'a/north.scd',
		documents: [
			{ id: 'd1', path: 'a/north.scdx/x.scd' },
			{ id: 'd2', path: 'a/north.sc' },
		],
		expected: undefined,
	},
	'a name differing by case only → none, places compare exactly': {
		path: 'a/north.scd',
		documents: [{ id: 'd1', path: 'a/North.scd' }],
		expected: undefined,
	},
	'the document asking, at the place → none': {
		path: 'a/north.scd',
		documents: [{ id: 'd1', path: 'a/north.scd' }],
		documentId: 'd1',
		expected: undefined,
	},
	'documents without a path → none, they hold no place': {
		path: 'a/north.scd',
		documents: [{ id: 'd1' }],
		expected: undefined,
	},
}

runTestCases.generic(holderCases, (testCase) => {
	const { path, documents, documentId, expected } = testCase
	expect(pathHolderOf({ path, documents, documentId })).toBe(expected)
})

type UpdateCase = BaseTestCase & {
	document: Partial<DocumentRecord>
	updates: DocumentUpdates
	/** the document after the updates; none when they are refused */
	expected?: Partial<DocumentRecord>
	/** the refusal's detail */
	refused?: RegExp
}

const updateCases: Record<string, UpdateCase> = {
	'a path on a document with one → moved and renamed: the name follows the file name': {
		document: { path: 'a/north.scd' },
		updates: { path: 'b/south.scd' },
		expected: { path: 'b/south.scd', name: 'south' },
	},
	'a path on a document without one → it takes it, the name follows': {
		document: {},
		updates: { path: 'b/north.scd' },
		expected: { path: 'b/north.scd', name: 'north' },
	},
	'a name on a document with a path → the file name in the path follows, its folders kept': {
		document: { path: 'a/b/north.scd' },
		updates: { name: 'south' },
		expected: { path: 'a/b/south.scd', name: 'south' },
	},
	'a name on a document at the root → the path follows': {
		document: { path: 'north.scd' },
		updates: { name: 'south' },
		expected: { path: 'south.scd', name: 'south' },
	},
	'a name and a path that agree → both applied': {
		document: { path: 'a/north.scd' },
		updates: { name: 'south', path: 'b/south.scd' },
		expected: { path: 'b/south.scd', name: 'south' },
	},
	'a name on a document without a path → as before, no path': {
		document: {},
		updates: { name: 'south' },
		expected: { name: 'south' },
	},
	'metadata on a document with a path → the path kept': {
		document: { path: 'a/north.scd' },
		updates: { metadata: { origin: 'x' } },
		expected: { path: 'a/north.scd', metadata: { origin: 'x' } },
	},
	'an extension with two dots kept by a move → the name less that extension': {
		document: { name: 'north', extension: '.tar.gz', path: 'a/north.tar.gz' },
		updates: { path: 'b/south.tar.gz' },
		expected: { path: 'b/south.tar.gz', name: 'south' },
	},
	'a name and a path that disagree → refused': {
		document: { path: 'a/north.scd' },
		updates: { name: 'east', path: 'b/south.scd' },
		refused: /does not end with the document's file name "east\.scd"/,
	},
	'a path of another extension → refused, a move keeps the extension': {
		document: { path: 'a/north.scd' },
		updates: { path: 'a/north.icd' },
		refused: /does not end with the document's extension "\.scd"/,
	},
	'a path that is only the extension → refused, a file name holds a name': {
		document: { path: 'a/north.scd' },
		updates: { path: 'a/.scd' },
		refused: /does not end with the document's extension "\.scd"/,
	},
	'a name with a separator on a document with a path → refused': {
		document: { path: 'a/north.scd' },
		updates: { name: 'x/south' },
		refused: /does not end with the document's file name "x\/south\.scd"/,
	},
	'a path breaking a rule → refused for that rule': {
		document: { path: 'a/north.scd' },
		updates: { path: 'a//north.scd' },
		refused: /an empty folder or file name/,
	},
	'a path given as undefined → the path kept, as the name': {
		document: { path: 'a/north.scd' },
		updates: { path: undefined },
		expected: { path: 'a/north.scd', name: 'north' },
	},
	'a name given as undefined, metadata given → the name kept': {
		document: { path: 'a/north.scd' },
		updates: { name: undefined, metadata: { origin: 'x' } },
		expected: { path: 'a/north.scd', name: 'north', metadata: { origin: 'x' } },
	},
	'metadata on a document whose stored path a rule now refuses → applied, the path not checked again':
		{
			document: { name: 'north', path: 'a/\u2066north.scd' },
			updates: { metadata: { origin: 'x' } },
			expected: { metadata: { origin: 'x' } },
		},
	'a name on a document whose stored path a rule now refuses → refused, the new path checked': {
		document: { name: 'north', path: 'a/\u2066north.scd' },
		updates: { name: 'south' },
		refused: /an invisible format, separator or control character/,
	},
	'keys an update does not take → ignored': {
		document: { path: 'a/north.scd' },
		updates: {
			id: 'zz',
			extension: '.icd',
			configKey: 'other',
			status: 'importing',
		} as DocumentUpdates,
		expected: {},
	},
	'a path given as null → refused, a path is a string': {
		document: { path: 'a/north.scd' },
		updates: { path: null as unknown as string },
		refused: /not a string/,
	},
}

for (const [description, testCase] of Object.entries(updateCases)) {
	it(`applyDocumentUpdates: ${description}`, async () => {
		const document = { ...DOCUMENT, ...testCase.document }
		const held = structuredClone(document)
		const applying = Promise.resolve().then(function apply() {
			return applyDocumentUpdates({ document, updates: testCase.updates })
		})
		if (testCase.refused) {
			await expectRejectsWith({
				action: applying,
				key: 'DOCUMENT_PATH_INVALID',
				detail: testCase.refused,
			})
		} else {
			expect(await applying).toEqual({ ...document, ...testCase.expected })
		}
		expect(document, 'the document given is not changed').toEqual(held)
	})
}

type PlaceCase = BaseTestCase & {
	document: Partial<DocumentRecord>
	documents: Pick<DocumentRecord, 'id' | 'path'>[]
	/** the refusal's key; none when the document passes */
	refused?: 'DOCUMENT_PATH_INVALID' | 'DOCUMENT_PATH_TAKEN'
	meta?: Record<string, unknown>
}

const placeCases: Record<string, PlaceCase> = {
	'no path → passes, whatever the registry holds': {
		document: {},
		documents: [{ id: 'd1', path: 'a/north.scd' }],
	},
	'a free place → passes': {
		document: { path: 'a/north.scd' },
		documents: [{ id: 'd1', path: 'b/north.scd' }],
	},
	'a place another document holds → DOCUMENT_PATH_TAKEN, that document named': {
		document: { path: 'a/north.scd' },
		documents: [{ id: 'd1', path: 'a/north.scd' }],
		refused: 'DOCUMENT_PATH_TAKEN',
		meta: { documentId: 'doc-1', path: 'a/north.scd', takenBy: 'd1' },
	},
	'its own place → passes': {
		document: { path: 'a/north.scd' },
		documents: [{ id: 'doc-1', path: 'a/north.scd' }],
	},
	'a path naming another file and a place held → DOCUMENT_PATH_INVALID first': {
		document: { path: 'a/south.scd' },
		documents: [{ id: 'd1', path: 'a/south.scd' }],
		refused: 'DOCUMENT_PATH_INVALID',
	},
}

for (const [description, testCase] of Object.entries(placeCases)) {
	it(`assertDocumentPlace: ${description}`, async () => {
		const document = { ...DOCUMENT, ...testCase.document }
		const check = Promise.resolve().then(function assertPlace() {
			assertDocumentPlace({ document, documents: testCase.documents })
		})
		if (!testCase.refused) return expect(check).resolves.toBeUndefined()
		await expectRejectsWith({ action: check, key: testCase.refused, meta: testCase.meta })
	})
}
