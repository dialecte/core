import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, XSD_NAMESPACE_URI } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'
import { selectNodes, withXmlDocument } from '@/test/xml'

import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'

// aEE_2 is a union of xs:integer and xs:QName: the first member whose lexical space admits the value reads it

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type Source = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']

/** The stored value of aEE_2 on the first EE_2. */
async function storedUnionValueOf(source: Source): Promise<string | undefined> {
	const [record] = await source.query.getRecordsByTagName('EE_2')
	const found = record?.attributes.find((attribute) => attribute.name === 'aEE_2')
	return found === undefined ? undefined : String(found.value)
}

/** The export of a case's document, compact. */
async function exportOf({
	project,
	source,
}: ActParams<TestDialecteConfig, BaseXmlTestCase>): Promise<string> {
	const { file } = await project.export({ documentId: source.documentId, indent: false })
	return file.text()
}

/** How many nodes of the text an XPath query selects (prefix `d` for the dialecte default). */
function countOf(params: { xml: string; query: string }): number {
	return withXmlDocument(
		{ xml: params.xml, label: 'the export' },
		(document) =>
			selectNodes({
				context: document,
				expression: params.query,
				namespaces: { d: DEFAULT_URI },
			}).length,
	)
}

// ── Import ───────────────────────────────────────────────────────────────────

describe('import - a union value is stored as its first admitting member reads it', () => {
	type TestCase = BaseXmlTestCase & { expected: string }

	const testCases: Record<string, TestCase> = {
		'an integer → the integer member: as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="12">Kind</EE_2></E>
				</Root>
			`,
			expected: '12',
		},
		'a QName whose prefix the file binds to a foreign namespace → the QName member: Clark': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="f:Kind">Kind</EE_2></E>
				</Root>
			`,
			expected: '{urn:f}Kind',
		},
		'a QName whose prefix the file binds to XSD → the QName member: xs:local': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:q="${XSD_NAMESPACE_URI}">
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="q:integer">Kind</EE_2></E>
				</Root>
			`,
			expected: 'xs:integer',
		},
		'a QName under a file prefix of the ext namespace, white space around → ext:local, collapsed': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:e="${EXT_URI}">
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2=" e:Kind ">Kind</EE_2></E>
				</Root>
			`,
			expected: 'ext:Kind',
		},
		'an unprefixed QName → the QName member: the dialecte default, local': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="Kind">Kind</EE_2></E>
				</Root>
			`,
			expected: 'Kind',
		},
		'a Clark name written in the file → no lexical QName, no member admits it: as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="{${EXT_URI}}Kind">Kind</EE_2></E>
				</Root>
			`,
			expected: `{${EXT_URI}}Kind`,
		},
		'a QName whose prefix nothing binds → no member admits it: as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="u:Kind">Kind</EE_2></E>
				</Root>
			`,
			expected: 'u:Kind',
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const stored = await storedUnionValueOf(source)
			expect(stored).toBe(testCase.expected)
		},
	})
})

// ── Export ───────────────────────────────────────────────────────────────────

describe('export - a union value read as a QName is written with the prefix its namespace takes', () => {
	type TestCase = BaseXmlTestCase & {
		/** Pieces of the export, as written. */
		contains: string[]
		/** XPath queries that each select exactly one node of the export. */
		queries: string[]
	}

	const testCases: Record<string, TestCase> = {
		'a foreign QName → its namespace declared on the root, the value under that prefix': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="f:Kind">Kind</EE_2></E>
				</Root>
			`,
			contains: ['xmlns:ns1="urn:f"', 'aEE_2="ns1:Kind"'],
			queries: ['//d:EE_2[@aEE_2="ns1:Kind"]'],
		},
		'an integer → written as stored, no namespace declared for it': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="12">Kind</EE_2></E>
				</Root>
			`,
			contains: ['aEE_2="12"'],
			queries: ['/d:Root[count(namespace::*) = 2]'],
		},
		'a QName in no namespace (an xmlns="" subtree) → the element under the alias, xmlns="" on it, the value unprefixed':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<E aE="e"><EE_1 aEE_1="Thing"/><d:EE_2 xmlns="" aEE_2="Kind">d:Kind</d:EE_2></E>
					</Root>
				`,
				contains: ['aEE_2="Kind"'],
				queries: ['//d:EE_2[@aEE_2="Kind"][not(namespace::*[name()=""][. != ""])]'],
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			for (const piece of params.testCase.contains) expect(xml).toContain(piece)
			for (const query of params.testCase.queries) expect(countOf({ xml, query })).toBe(1)
		},
	})
})

describe('export - a union value read as a QName survives the round trip', () => {
	type TestCase = BaseXmlTestCase

	const testCases: Record<string, TestCase> = {
		'the compact export of a foreign QName in a union → the export is the same text': {
			sourceXml: `<?xml version="1.0" encoding="UTF-8"?><Root xmlns="${DEFAULT_URI}" xmlns:ns1="urn:f"><E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="ns1:Kind">Kind</EE_2></E></Root>`,
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			await expect(exportOf(params)).resolves.toBe(params.testCase.sourceXml)
		},
	})
})

// ── Writes ───────────────────────────────────────────────────────────────────

describe('write - a union value is stored as its first admitting member reads it', () => {
	type TestCase = BaseXmlTestCase & {
		value: string
		expected: { key?: string; stored?: string }
	}

	const sourceXml = /* xml */ `
		<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}>
			<E ${customId}="e" aE="e"><EE_1 ${customId}="ee1" aEE_1="Thing"/></E>
		</Root>
	`

	const testCases: Record<string, TestCase> = {
		'an integer → stored as given': { sourceXml, value: '12', expected: { stored: '12' } },
		'a QName of a config prefix → stored as given': {
			sourceXml,
			value: 'ext:Kind',
			expected: { stored: 'ext:Kind' },
		},
		'a Clark name of the ext namespace → stored ext:local': {
			sourceXml,
			value: `{${EXT_URI}}Kind`,
			expected: { stored: 'ext:Kind' },
		},
		'a Clark name of XSD → stored xs:local': {
			sourceXml,
			value: `{${XSD_NAMESPACE_URI}}integer`,
			expected: { stored: 'xs:integer' },
		},
		'a foreign Clark name → stored as given': {
			sourceXml,
			value: '{urn:f}Kind',
			expected: { stored: '{urn:f}Kind' },
		},
		'a prefix outside the engine table → UNKNOWN_NAMESPACE_PREFIX': {
			sourceXml,
			value: 'u:Kind',
			expected: { key: 'UNKNOWN_NAMESPACE_PREFIX' },
		},
		'a Clark name with no local name → UNKNOWN_NAMESPACE_PREFIX': {
			sourceXml,
			value: '{urn:f}',
			expected: { key: 'UNKNOWN_NAMESPACE_PREFIX' },
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const key = await source
				.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_2', attributes: { aEE_2: testCase.value }, value: 'Kind' },
					)
				})
				.then(
					() => undefined,
					(error: unknown) => toDialecteError(error)?.key,
				)
			if (key !== undefined) {
				expect({ key }).toEqual(testCase.expected)
				return
			}
			const stored = await storedUnionValueOf(source)
			expect({ stored }).toEqual(testCase.expected)
		},
	})
})
