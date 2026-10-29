import { writeXmlRecords } from './write-xml-records'
import { XmlWriter } from './xml-writer'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { DIALECTE_TEST_NAMESPACES, runTestCases, TEST_DIALECTE_CONFIG } from '@/test'
import { parseXml } from '@/test/xml-dom'

import type { DialecteErrorKey } from '@/errors'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

const NS = DIALECTE_TEST_NAMESPACES
const CONFIG = TEST_DIALECTE_CONFIG

function record(
	overrides: Partial<AnyRawRecord> & Pick<AnyRawRecord, 'id' | 'tagName'>,
): AnyRawRecord {
	return {
		namespace: NS.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
		...overrides,
	}
}

function ref(params: { id: string; tagName: string }): AnyRawRecord['children'][number] {
	const { id, tagName } = params
	return { id, tagName }
}

/** The document root holding the children named by id (their tag read from `TAG_OF_ID`). */
function rootOf(childIds: string[]): AnyRawRecord {
	return record({ id: 'root-1', tagName: 'Root', children: childIds.map(childRefOf) })
}

function childRefOf(id: string): AnyRawRecord['children'][number] {
	return { id, tagName: TAG_OF_ID[id] ?? id }
}

const TAG_OF_ID: Record<string, string> = {
	'a-1': 'A',
	'b-1': 'B',
	'c-1': 'C',
	'f-1': 'F',
	'o-1': 'O',
	'aa3-1': 'AA_3',
}

function childRecord(
	overrides: Partial<AnyRawRecord> &
		Pick<AnyRawRecord, 'id' | 'tagName'> & { parentId?: string; parentTag?: string },
): AnyRawRecord {
	const { parentId = 'root-1', parentTag = 'Root', ...rest } = overrides
	return record({ parent: { id: parentId, tagName: parentTag }, ...rest })
}

function xsiType(value: string): AnyRawRecord['attributes'][number] {
	return { name: 'type', value, namespace: NS.xsi }
}

const THREE_LEVELS: AnyRawRecord[] = [
	record({ id: 'root-1', tagName: 'Root', children: [ref({ id: 'a-1', tagName: 'A' })] }),
	childRecord({
		id: 'a-1',
		tagName: 'A',
		attributes: [{ name: 'aA', value: 'val' }],
		children: [ref({ id: 'aa1-1', tagName: 'AA_1' })],
	}),
	childRecord({
		id: 'aa1-1',
		tagName: 'AA_1',
		parentId: 'a-1',
		parentTag: 'A',
		attributes: [{ name: 'aAA_1', value: 'deep' }],
	}),
]

// the root admits a type, with xsi:type, that fixes a `version` attribute
const VERSIONED_TYPE = `{${NS.default.uri}}tVersioned`
const VERSIONED_CONFIG = {
	...CONFIG,
	definition: {
		...CONFIG.definition,
		Root: { ...CONFIG.definition.Root, variants: [VERSIONED_TYPE] },
	},
	types: {
		[VERSIONED_TYPE]: {
			attributes: { sequence: ['version'], details: { version: { fixed: '2' } } },
			children: CONFIG.definition.Root.children,
		},
	},
} as unknown as AnyDialecteConfig

// the root fixes its qualified `ext:root`: written once a descendant declares `ext` on the root
const FIXED_QUALIFIED_ROOT_CONFIG = {
	...CONFIG,
	definition: {
		...CONFIG.definition,
		Root: {
			...CONFIG.definition.Root,
			attributes: {
				...CONFIG.definition.Root.attributes,
				details: {
					...CONFIG.definition.Root.attributes.details,
					'ext:root': { ...CONFIG.definition.Root.attributes.details['ext:root'], fixed: '9' },
					root: { ...CONFIG.definition.Root.attributes.details.root, fixed: '8' },
				},
			},
		},
	},
} as unknown as AnyDialecteConfig

type WriterCase = BaseTestCase & {
	records: AnyRawRecord[]
	config?: AnyDialecteConfig
	rootId?: string
	declareNamespaces?: boolean
	includeXmlDeclaration?: boolean
	withDatabaseIds?: boolean
	/** The bytes written, formatted and compact */
	expected: { formatted: string; compact: string }
}

/** The lines of a formatted file, joined as it writes them. */
function crlf(lines: string[]): string {
	return lines.join('\r\n')
}

function writtenOf(params: { testCase: WriterCase; indent: boolean }): string {
	const { testCase, indent } = params
	const { records, rootId, declareNamespaces, withDatabaseIds, includeXmlDeclaration } = testCase
	return writeXmlRecords({
		records,
		config: testCase.config ?? CONFIG,
		rootId,
		declareNamespaces,
		withDatabaseIds,
		includeXmlDeclaration,
		indent,
	})
}

describe('writeXmlRecords', () => {
	describe('writes what XMLSerializer writes for the same elements', () => {
		const testCases: Record<string, WriterCase> = {
			'root only -> its start tag, self-closed': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1"/>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1"/>',
				},
				records: [
					record({ id: 'root-1', tagName: 'Root', attributes: [{ name: 'root', value: '1' }] }),
				],
			},
			'a root holding one child -> the child indented below it': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="hello"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="hello"/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({ id: 'a-1', tagName: 'A', attributes: [{ name: 'aA', value: 'hello' }] }),
				],
			},
			'three levels -> each indented one level more': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="val">',
						'        <AA_1 aAA_1="deep"/>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="val"><AA_1 aAA_1="deep"/></A></Root>',
				},
				records: THREE_LEVELS,
			},
			"a text value -> trimmed, on its element's line": {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x">',
						'        <AA_1 aAA_1="">some text</AA_1>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x"><AA_1 aAA_1="">some text</AA_1></A></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }],
						children: [ref({ id: 'aa1-1', tagName: 'AA_1' })],
					}),
					childRecord({
						id: 'aa1-1',
						tagName: 'AA_1',
						parentId: 'a-1',
						parentTag: 'A',
						value: '  some text  ',
					}),
				],
			},
			'children reordered by the dialecte sequence, unknown ones last': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x"/>',
						'    <B aB="x"/>',
						'    <C aC="x"/>',
						'    <Unknown/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x"/><B aB="x"/><C aC="x"/><Unknown/></Root>',
				},
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [
							ref({ id: 'unknown-1', tagName: 'Unknown' }),
							ref({ id: 'c-1', tagName: 'C' }),
							ref({ id: 'a-1', tagName: 'A' }),
							ref({ id: 'b-1', tagName: 'B' }),
						],
					}),
					childRecord({ id: 'unknown-1', tagName: 'Unknown' }),
					childRecord({ id: 'c-1', tagName: 'C', attributes: [{ name: 'aC', value: 'x' }] }),
					childRecord({ id: 'a-1', tagName: 'A', attributes: [{ name: 'aA', value: 'x' }] }),
					childRecord({ id: 'b-1', tagName: 'B', attributes: [{ name: 'aB', value: 'x' }] }),
				],
			},
			'a child the leading wildcard admits -> written at the wildcard, before the declared children':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
							'    <C aC="x">',
							'        <CC_2 aCC_2="x">',
							'            <ext:CCCC_3 ext:aCCCC_3="x"/>',
							'            <CCC_1 aCCC_1="x"/>',
							'        </CC_2>',
							'    </C>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><C aC="x"><CC_2 aCC_2="x"><ext:CCCC_3 ext:aCCCC_3="x"/><CCC_1 aCCC_1="x"/></CC_2></C></Root>',
					},
					records: [
						rootOf(['c-1']),
						childRecord({
							id: 'c-1',
							tagName: 'C',
							attributes: [{ name: 'aC', value: 'x' }],
							children: [ref({ id: 'cc2-1', tagName: 'CC_2' })],
						}),
						childRecord({
							id: 'cc2-1',
							tagName: 'CC_2',
							parentId: 'c-1',
							parentTag: 'C',
							attributes: [{ name: 'aCC_2', value: 'x' }],
							children: [
								ref({ id: 'ccc1-1', tagName: 'CCC_1' }),
								ref({ id: 'cccc3-1', tagName: 'CCCC_3' }),
							],
						}),
						childRecord({
							id: 'ccc1-1',
							tagName: 'CCC_1',
							parentId: 'cc2-1',
							parentTag: 'CC_2',
							attributes: [{ name: 'aCCC_1', value: 'x' }],
						}),
						childRecord({
							id: 'cccc3-1',
							tagName: 'CCCC_3',
							parentId: 'cc2-1',
							parentTag: 'CC_2',
							namespace: NS.ext,
							attributes: [{ name: 'aCCCC_3', value: 'x', namespace: NS.ext }],
						}),
					],
				},
			'database ids asked -> on every element': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" _temp-idb-id="root-1">',
						'    <A aA="val" _temp-idb-id="a-1">',
						'        <AA_1 aAA_1="deep" _temp-idb-id="aa1-1"/>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" _temp-idb-id="root-1"><A aA="val" _temp-idb-id="a-1"><AA_1 aAA_1="deep" _temp-idb-id="aa1-1"/></A></Root>',
				},
				records: THREE_LEVELS,
				withDatabaseIds: true,
			},
			'a missing required attribute -> materialized empty': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA=""/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA=""/></Root>',
				},
				records: [rootOf(['a-1']), childRecord({ id: 'a-1', tagName: 'A' })],
			},
			'a missing fixed attribute -> its fixed value': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <C aC="">',
						'        <CC_1 aCC_1="fixed_val"/>',
						'    </C>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><C aC=""><CC_1 aCC_1="fixed_val"/></C></Root>',
				},
				records: [
					rootOf(['c-1']),
					childRecord({
						id: 'c-1',
						tagName: 'C',
						children: [ref({ id: 'cc-1', tagName: 'CC_1' })],
					}),
					childRecord({ id: 'cc-1', tagName: 'CC_1', parentId: 'c-1', parentTag: 'C' }),
				],
			},
			'an absent optional default -> not materialized': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <B aB="">',
						'        <BB_1 aBB_1="req"/>',
						'    </B>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><B aB=""><BB_1 aBB_1="req"/></B></Root>',
				},
				records: [
					rootOf(['b-1']),
					childRecord({
						id: 'b-1',
						tagName: 'B',
						children: [ref({ id: 'bb-1', tagName: 'BB_1' })],
					}),
					childRecord({
						id: 'bb-1',
						tagName: 'BB_1',
						parentId: 'b-1',
						parentTag: 'B',
						attributes: [{ name: 'aBB_1', value: 'req' }],
					}),
				],
			},
			'an element of another namespace -> prefixed, declared on the root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <ext:AA_3 aAA_3="val" ext:aAA_3=""/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 aAA_3="val" ext:aAA_3=""/></Root>',
				},
				records: [
					rootOf(['aa3-1']),
					childRecord({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						attributes: [{ name: 'aAA_3', value: 'val' }],
					}),
				],
			},
			'a qualified attribute -> its namespace declared on the root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <A aA="val" ext:cA="ext-val"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><A aA="val" ext:cA="ext-val"/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [
							{ name: 'aA', value: 'val' },
							{ name: 'cA', value: 'ext-val', namespace: NS.ext },
						],
					}),
				],
			},
			'namespace declarations of the record -> not written as attributes': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1"/>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1"/>',
				},
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [
							{ name: 'xmlns', value: NS.default.uri },
							{ name: 'xmlns:ext', value: NS.ext.uri },
							{ name: 'root', value: '1' },
						],
					}),
				],
			},
			'a qualified root attribute -> declared inline, or moved once a child declares it': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" ext:root="2" b="x">',
						'    <A aA="x"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" ext:root="2" b="x"><A aA="x"/></Root>',
				},
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [
							{ name: 'root', value: '1' },
							{ name: 'root', value: '2', namespace: NS.ext },
							{ name: 'b', value: 'x' },
						],
						children: [ref({ id: 'a-1', tagName: 'A' })],
					}),
					childRecord({ id: 'a-1', tagName: 'A', attributes: [{ name: 'aA', value: 'x' }] }),
				],
			},
			'a qualified root attribute declared again by a descendant -> one declaration, after the root attributes':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" ext:root="2" b="x" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
							'    <ext:AA_3 aAA_3="v" ext:aAA_3=""/>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" ext:root="2" b="x" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 aAA_3="v" ext:aAA_3=""/></Root>',
					},
					records: [
						record({
							id: 'root-1',
							tagName: 'Root',
							attributes: [
								{ name: 'root', value: '2', namespace: NS.ext },
								{ name: 'b', value: 'x' },
							],
							children: [ref({ id: 'aa3-1', tagName: 'AA_3' })],
						}),
						childRecord({
							id: 'aa3-1',
							tagName: 'AA_3',
							namespace: NS.ext,
							attributes: [{ name: 'aAA_3', value: 'v' }],
						}),
					],
				},
			'an unprefixed element of a foreign namespace -> default re-declared around it': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <F xmlns="urn:foreign">',
						'        <G xmlns="http://dialecte.dev/XML/DEFAULT"/>',
						'    </F>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><F xmlns="urn:foreign"><G xmlns="http://dialecte.dev/XML/DEFAULT"/></F></Root>',
				},
				records: [
					rootOf(['f-1']),
					childRecord({
						id: 'f-1',
						tagName: 'F',
						namespace: { prefix: '', uri: 'urn:foreign' },
						children: [ref({ id: 'g-1', tagName: 'G' })],
					}),
					childRecord({ id: 'g-1', tagName: 'G', parentId: 'f-1', parentTag: 'F' }),
				],
			},
			'a prefix bound to another namespace by a descendant -> re-declared on it': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <ext:AA_3 ext:aAA_3=""/>',
						'    <ext:O xmlns:ext="urn:other"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 ext:aAA_3=""/><ext:O xmlns:ext="urn:other"/></Root>',
				},
				records: [
					rootOf(['aa3-1', 'o-1']),
					childRecord({ id: 'aa3-1', tagName: 'AA_3', namespace: NS.ext }),
					childRecord({ id: 'o-1', tagName: 'O', namespace: { prefix: 'ext', uri: 'urn:other' } }),
				],
			},
			'a qualified root attribute and a child re-binding its prefix -> one declaration per prefix':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ns1="http://dialecte.dev/XML/DEV-EXT" ns1:root="2" xmlns:ext="urn:other">',
							'    <ext:O/>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ns1="http://dialecte.dev/XML/DEV-EXT" ns1:root="2" xmlns:ext="urn:other"><ext:O/></Root>',
					},
					records: [
						record({
							id: 'root-1',
							tagName: 'Root',
							attributes: [{ name: 'root', value: '2', namespace: NS.ext }],
							children: [ref({ id: 'o-1', tagName: 'O' })],
						}),
						childRecord({
							id: 'o-1',
							tagName: 'O',
							namespace: { prefix: 'ext', uri: 'urn:other' },
						}),
					],
				},
			"an element re-binding a prefix holds an attribute of the prefix's first namespace -> a generated prefix for the attribute":
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="urn:other">',
							'    <ext:O xmlns:ns1="http://dialecte.dev/XML/DEV-EXT" ns1:cA="v"/>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="urn:other"><ext:O xmlns:ns1="http://dialecte.dev/XML/DEV-EXT" ns1:cA="v"/></Root>',
					},
					records: [
						rootOf(['o-1']),
						childRecord({
							id: 'o-1',
							tagName: 'O',
							namespace: { prefix: 'ext', uri: 'urn:other' },
							attributes: [{ name: 'cA', value: 'v', namespace: NS.ext }],
						}),
					],
				},
			'an attribute whose prefix is unbound while another prefix binds its namespace -> its own prefix declared':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns:alias="http://dialecte.dev/XML/DEV-EXT">',
							'    <ext:AA_3 alias:q="v" ext:aAA_3=""/>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns:alias="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 alias:q="v" ext:aAA_3=""/></Root>',
					},
					records: [
						rootOf(['aa3-1']),
						childRecord({
							id: 'aa3-1',
							tagName: 'AA_3',
							namespace: NS.ext,
							attributes: [
								{ name: 'q', value: 'v', namespace: { prefix: 'alias', uri: NS.ext.uri } },
							],
						}),
					],
				},
			'a fixed qualified root attribute -> written on the root once a descendant declares its namespace':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" root="8" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" ext:root="9">',
							'    <A aA="x"/>',
							'    <ext:AA_3 ext:aAA_3=""/>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" root="8" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" ext:root="9"><A aA="x"/><ext:AA_3 ext:aAA_3=""/></Root>',
					},
					records: [
						record({
							id: 'root-1',
							tagName: 'Root',
							children: [ref({ id: 'a-1', tagName: 'A' }), ref({ id: 'aa3-1', tagName: 'AA_3' })],
						}),
						childRecord({ id: 'a-1', tagName: 'A', attributes: [{ name: 'aA', value: 'x' }] }),
						childRecord({ id: 'aa3-1', tagName: 'AA_3', namespace: NS.ext }),
					],
					config: FIXED_QUALIFIED_ROOT_CONFIG,
				},
			'an optional qualified root default -> not written when its namespace is declared': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <ext:AA_3 aAA_3="val" ext:aAA_3=""/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 aAA_3="val" ext:aAA_3=""/></Root>',
				},
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [{ name: 'root', value: '1' }],
						children: [ref({ id: 'aa3-1', tagName: 'AA_3' })],
					}),
					childRecord({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						attributes: [{ name: 'aAA_3', value: 'val' }],
					}),
				],
			},
			'an attribute equal to its schema default -> kept': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <B aB="x">',
						'        <BB_1 aBB_1="req">',
						'            <BBB_1 aBBB_1="req" bBBB_1="false"/>',
						'        </BB_1>',
						'    </B>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><B aB="x"><BB_1 aBB_1="req"><BBB_1 aBBB_1="req" bBBB_1="false"/></BB_1></B></Root>',
				},
				records: [
					rootOf(['b-1']),
					childRecord({
						id: 'b-1',
						tagName: 'B',
						attributes: [{ name: 'aB', value: 'x' }],
						children: [ref({ id: 'bb1-1', tagName: 'BB_1' })],
					}),
					childRecord({
						id: 'bb1-1',
						tagName: 'BB_1',
						parentId: 'b-1',
						parentTag: 'B',
						attributes: [{ name: 'aBB_1', value: 'req' }],
						children: [ref({ id: 'bbb1-1', tagName: 'BBB_1' })],
					}),
					childRecord({
						id: 'bbb1-1',
						tagName: 'BBB_1',
						parentId: 'bb1-1',
						parentTag: 'BB_1',
						attributes: [
							{ name: 'aBBB_1', value: 'req' },
							{ name: 'bBBB_1', value: 'false' },
						],
					}),
				],
			},
			'tabs, carriage returns and a lone carriage return in a text value -> as is formatted, a carriage return as a reference compact':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
							'    <A aA="x">one\ttwo\rthree</A>',
							'    <B aB="x">four',
							'five</B>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x">one\ttwo&#13;three</A><B aB="x">four&#13;\nfive</B></Root>',
					},
					records: [
						rootOf(['a-1', 'b-1']),
						childRecord({
							id: 'a-1',
							tagName: 'A',
							attributes: [{ name: 'aA', value: 'x' }],
							value: 'one\ttwo\rthree',
						}),
						childRecord({
							id: 'b-1',
							tagName: 'B',
							attributes: [{ name: 'aB', value: 'x' }],
							value: 'four\r\nfive\r',
						}),
					],
				},
			'a fragment rooted at an element of another namespace -> its prefix declared on it': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<ext:AA_3 xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns="http://dialecte.dev/XML/DEV-EXT" aAA_3="x" ext:cA="e"/>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><ext:AA_3 xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns="http://dialecte.dev/XML/DEV-EXT" aAA_3="x" ext:cA="e"/>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'v' }],
						children: [ref({ id: 'aa3-1', tagName: 'AA_3' })],
					}),
					childRecord({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						parentId: 'a-1',
						parentTag: 'A',
						attributes: [
							{ name: 'aAA_3', value: 'x' },
							{ name: 'cA', value: 'e', namespace: NS.ext },
						],
					}),
				],
				rootId: 'aa3-1',
			},
			'special characters in attribute and text values -> escaped as the serializer escapes them': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="&amp;&lt;&gt;&quot;\'&#9;&#10;&#13; x">&amp;&lt;&gt;"\' y</A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="&amp;&lt;&gt;&quot;\'&#9;&#10;&#13; x">&amp;&lt;&gt;"\' y</A></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: `&<>"'\t\n\r x` }],
						value: `&<>"' y`,
					}),
				],
			},
			'a multi-line text value alone -> on its line, LF written CRLF; compact: a carriage return as a reference':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
							'    <A aA="x">one',
							'two',
							'three</A>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x">one\ntwo&#13;\nthree</A></Root>',
					},
					records: [
						rootOf(['a-1']),
						childRecord({
							id: 'a-1',
							tagName: 'A',
							attributes: [{ name: 'aA', value: 'x' }],
							value: 'one\ntwo\r\nthree',
						}),
					],
				},
			'a whitespace-only value -> no text': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x"/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }],
						value: '   ',
					}),
				],
			},
			'a one-line value next to children -> the whole subtree on one line': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x">mixed<AA_1 aAA_1=""><AAA_1 aAAA_1="">deep</AAA_1></AA_1></A>',
						'    <B aB="x"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x">mixed<AA_1 aAA_1=""><AAA_1 aAAA_1="">deep</AAA_1></AA_1></A><B aB="x"/></Root>',
				},
				records: [
					rootOf(['a-1', 'b-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }],
						value: 'mixed',
						children: [ref({ id: 'aa1-1', tagName: 'AA_1' })],
					}),
					childRecord({
						id: 'aa1-1',
						tagName: 'AA_1',
						parentId: 'a-1',
						parentTag: 'A',
						children: [ref({ id: 'aaa1-1', tagName: 'AAA_1' })],
					}),
					childRecord({
						id: 'aaa1-1',
						tagName: 'AAA_1',
						parentId: 'aa1-1',
						parentTag: 'AA_1',
						value: 'deep',
					}),
					childRecord({ id: 'b-1', tagName: 'B', attributes: [{ name: 'aB', value: 'x' }] }),
				],
			},
			'a multi-line value next to children -> the text on its own line': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x">',
						'        line one',
						'line two',
						'        <AA_1 aAA_1=""/>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x">line one\nline two<AA_1 aAA_1=""/></A></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }],
						value: 'line one\nline two',
						children: [ref({ id: 'aa1-1', tagName: 'AA_1' })],
					}),
					childRecord({ id: 'aa1-1', tagName: 'AA_1', parentId: 'a-1', parentTag: 'A' }),
				],
			},
			'xml:space="preserve" -> the subtree as written': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xml="http://www.w3.org/XML/1998/namespace">',
						'    <A aA="x" xml:space="preserve"><AA_1 aAA_1=""><AAA_1 aAAA_1=""/></AA_1></A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xml="http://www.w3.org/XML/1998/namespace"><A aA="x" xml:space="preserve"><AA_1 aAA_1=""><AAA_1 aAAA_1=""/></AA_1></A></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [
							{ name: 'aA', value: 'x' },
							{
								name: 'space',
								value: 'preserve',
								namespace: { prefix: 'xml', uri: 'http://www.w3.org/XML/1998/namespace' },
							},
						],
						children: [ref({ id: 'aa1-1', tagName: 'AA_1' })],
					}),
					childRecord({
						id: 'aa1-1',
						tagName: 'AA_1',
						parentId: 'a-1',
						parentTag: 'A',
						children: [ref({ id: 'aaa1-1', tagName: 'AAA_1' })],
					}),
					childRecord({ id: 'aaa1-1', tagName: 'AAA_1', parentId: 'aa1-1', parentTag: 'AA_1' }),
				],
			},
			"a text value on the root -> written like any element's": {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">root text<A aA=""/></Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT">root text<A aA=""/></Root>',
				},
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						value: 'root text',
						children: [ref({ id: 'a-1', tagName: 'A' })],
					}),
					childRecord({ id: 'a-1', tagName: 'A' }),
				],
			},
			'an empty attribute value -> written as given': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="x" bA=""/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="x" bA=""/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [
							{ name: 'aA', value: 'x' },
							{ name: 'bA', value: '' },
						],
					}),
				],
			},
			'a fragment rooted at a non-root element -> no root attributes': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<A xmlns="http://dialecte.dev/XML/DEFAULT" aA="val">',
						'    <AA_1 aAA_1="deep"/>',
						'</A>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><A xmlns="http://dialecte.dev/XML/DEFAULT" aA="val"><AA_1 aAA_1="deep"/></A>',
				},
				records: THREE_LEVELS,
				rootId: 'a-1',
			},
			'a fragment rooted at the document root -> the whole document': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="val">',
						'        <AA_1 aAA_1="deep"/>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="val"><AA_1 aAA_1="deep"/></A></Root>',
				},
				records: THREE_LEVELS,
				rootId: 'root-1',
			},
			'a fragment holding another namespace -> declared on the fragment root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<A xmlns="http://dialecte.dev/XML/DEFAULT" aA="v" ext:cA="e" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <ext:AA_3 ext:aAA_3=""/>',
						'</A>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><A xmlns="http://dialecte.dev/XML/DEFAULT" aA="v" ext:cA="e" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><ext:AA_3 ext:aAA_3=""/></A>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [
							{ name: 'aA', value: 'v' },
							{ name: 'cA', value: 'e', namespace: NS.ext },
						],
						children: [ref({ id: 'aa3-1', tagName: 'AA_3' })],
					}),
					childRecord({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						parentId: 'a-1',
						parentTag: 'A',
					}),
				],
				rootId: 'a-1',
			},
			'a bare fragment -> no declarations, prefixed names written literally': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<A aA="val" ext:cA="ext-val">',
						'    <ext:AA_3 aAA_3="x"/>',
						'</A>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><A aA="val" ext:cA="ext-val"><ext:AA_3 aAA_3="x"/></A>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [
							{ name: 'aA', value: 'val' },
							{ name: 'cA', value: 'ext-val', namespace: NS.ext },
						],
						children: [ref({ id: 'aa3-1', tagName: 'AA_3' })],
					}),
					childRecord({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						parentId: 'a-1',
						parentTag: 'A',
						attributes: [{ name: 'aAA_3', value: 'x' }],
					}),
				],
				rootId: 'a-1',
				declareNamespaces: false,
			},
			'no XML declaration asked -> the root first': {
				expected: {
					formatted: crlf([
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
						'    <A aA="val">',
						'        <AA_1 aAA_1="deep"/>',
						'    </A>',
						'</Root>',
					]),
					compact:
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT"><A aA="val"><AA_1 aAA_1="deep"/></A></Root>',
				},
				records: THREE_LEVELS,
				includeXmlDeclaration: false,
			},
			'no XML declaration, a fragment -> the fragment root first': {
				expected: {
					formatted: crlf([
						'<A xmlns="http://dialecte.dev/XML/DEFAULT" aA="val">',
						'    <AA_1 aAA_1="deep"/>',
						'</A>',
					]),
					compact: '<A xmlns="http://dialecte.dev/XML/DEFAULT" aA="val"><AA_1 aAA_1="deep"/></A>',
				},
				records: THREE_LEVELS,
				includeXmlDeclaration: false,
				rootId: 'a-1',
			},
			'an xsi:type of the default namespace -> written as stored': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
						'    <A aA="x" xsi:type="tSomething"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><A aA="x" xsi:type="tSomething"/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }, xsiType('tSomething')],
					}),
				],
			},
			'an xsi:type of a dialecte prefix -> declared on the root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ext="http://dialecte.dev/XML/DEV-EXT">',
						'    <A aA="x" xsi:type="ext:tExt"/>',
						'</Root>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><A aA="x" xsi:type="ext:tExt"/></Root>',
				},
				records: [
					rootOf(['a-1']),
					childRecord({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }, xsiType('ext:tExt')],
					}),
				],
			},
			'an xsi:type of the default namespace under a foreign default -> a free prefix declared on the element':
				{
					expected: {
						formatted: crlf([
							'<?xml version="1.0" encoding="UTF-8"?>',
							'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
							'    <F xmlns="urn:foreign">',
							'        <G xsi:type="ns1:tSomething" xmlns:ns1="http://dialecte.dev/XML/DEFAULT"/>',
							'    </F>',
							'</Root>',
						]),
						compact:
							'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><F xmlns="urn:foreign"><G xsi:type="ns1:tSomething" xmlns:ns1="http://dialecte.dev/XML/DEFAULT"/></F></Root>',
					},
					records: [
						rootOf(['f-1']),
						childRecord({
							id: 'f-1',
							tagName: 'F',
							namespace: { prefix: '', uri: 'urn:foreign' },
							children: [ref({ id: 'g-1', tagName: 'G' })],
						}),
						childRecord({
							id: 'g-1',
							tagName: 'G',
							namespace: { prefix: '', uri: 'urn:foreign' },
							parentId: 'f-1',
							parentTag: 'F',
							attributes: [xsiType('tSomething')],
						}),
					],
				},
			'an xsi:type on the root -> its prefix bound on the root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="tRoot"/>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="tRoot"/>',
				},
				records: [record({ id: 'root-1', tagName: 'Root', attributes: [xsiType('tRoot')] })],
			},
			'the root type names a fixed attribute -> materialized on the root': {
				expected: {
					formatted: crlf([
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="tVersioned" version="2"/>',
					]),
					compact:
						'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="tVersioned" version="2"/>',
				},
				records: [record({ id: 'root-1', tagName: 'Root', attributes: [xsiType('tVersioned')] })],
				config: VERSIONED_CONFIG,
			},
		}

		runTestCases.generic(testCases, (testCase) => {
			expect(writtenOf({ testCase, indent: true })).toBe(testCase.expected.formatted)
			expect(writtenOf({ testCase, indent: false })).toBe(testCase.expected.compact)
		})
	})

	describe('refuses what it cannot write', () => {
		type ErrorCase = BaseTestCase & {
			records: AnyRawRecord[]
			rootId?: string
			expectedKey: DialecteErrorKey
			expectedError: string
		}
		const testCases: Record<string, ErrorCase> = {
			'no root record -> EXPORT_ROOT_NOT_FOUND': {
				records: [childRecord({ id: 'a-1', tagName: 'A' })],
				expectedKey: 'EXPORT_ROOT_NOT_FOUND',
				expectedError: 'No Root root element found in records',
			},
			'a root tag that has a parent is not the document root -> EXPORT_ROOT_NOT_FOUND': {
				records: [childRecord({ id: 'root-2', tagName: 'Root' })],
				expectedKey: 'EXPORT_ROOT_NOT_FOUND',
				expectedError: 'No Root root element found in records',
			},
			'an unknown rootId -> EXPORT_ROOT_NOT_FOUND': {
				records: THREE_LEVELS,
				rootId: 'nope',
				expectedKey: 'EXPORT_ROOT_NOT_FOUND',
				expectedError: 'No record found for rootId "nope"',
			},
			'a child id with no record -> EXPORT_ORPHAN_CHILD_REF': {
				records: [rootOf(['a-1', 'missing-id']), childRecord({ id: 'a-1', tagName: 'A' })],
				expectedKey: 'EXPORT_ORPHAN_CHILD_REF',
				expectedError: "Parent 'Root' references non-existent child 'missing-id' (id: missing-id)",
			},
		}

		runTestCases.generic(testCases, (testCase) => {
			let thrown: unknown
			try {
				writeXmlRecords({ records: testCase.records, config: CONFIG, rootId: testCase.rootId })
			} catch (error) {
				thrown = error
			}
			expect(toDialecteError(thrown)?.key).toBe(testCase.expectedKey)
			expect(toDialecteError(thrown)?.detail).toBe(testCase.expectedError)
		})
	})

	describe('hands its output in parts', () => {
		it('the body taken after every element, the root gaining a declaration mid-way -> the bytes written in one go', () => {
			const records = [
				rootOf(['a-1']),
				childRecord({
					id: 'a-1',
					tagName: 'A',
					attributes: [{ name: 'cA', value: 'e', namespace: NS.ext }],
				}),
			]
			const writer = new XmlWriter({ config: CONFIG, documentRoot: records[0] })
			const parts: string[] = []
			writer.openElement({ record: records[0]! })
			parts.push(writer.take())
			writer.openElement({ record: records[1]! })
			parts.push(writer.take())
			writer.closeElement()
			parts.push(writer.take())
			writer.closeElement()
			parts.push(writer.take())
			const written = writer.head() + parts.join('')
			expect(written).toContain('xmlns:ext=')
			expect(written).toBe(writeXmlRecords({ records, config: CONFIG }))
		})
	})

	describe('a prefix the root generates for its own attribute', () => {
		it('the root renumbered by a later declaration -> every attribute still in its namespace, the file well-formed', () => {
			const records = [
				record({
					id: 'root-1',
					tagName: 'Root',
					attributes: [{ name: 'root', value: '2', namespace: NS.ext }],
					children: [
						ref({ id: 'o-1', tagName: 'O' }),
						ref({ id: 'x-1', tagName: 'X' }),
						ref({ id: 'n-1', tagName: 'N' }),
					],
				}),
				childRecord({ id: 'o-1', tagName: 'O', namespace: { prefix: 'ext', uri: 'urn:other' } }),
				childRecord({
					id: 'x-1',
					tagName: 'X',
					attributes: [{ name: 'cA', value: 'v', namespace: NS.ext }],
				}),
				childRecord({ id: 'n-1', tagName: 'N', namespace: { prefix: 'ns1', uri: 'urn:x' } }),
			]
			for (const indent of [true, false]) {
				const parsed = parseXml({ xml: writeXmlRecords({ records, config: CONFIG, indent }) })
				if ('error' in parsed) throw new Error(`the file is not well-formed: ${parsed.error}`)
				const root = parsed.document.documentElement!
				expect(root.getAttributeNS(NS.ext.uri, 'root')).toBe('2')
				const elementX = [...root.children].find((child) => child.localName === 'X')!
				expect(elementX.getAttributeNS(NS.ext.uri, 'cA')).toBe('v')
				const elementN = [...root.children].find((child) => child.localName === 'N')!
				expect(elementN.namespaceURI).toBe('urn:x')
			}
		})
	})
})
