import { describe, expect } from 'vitest'

import { XSD_NAMESPACE_URI } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { selectNodes, withXmlDocument } from '@/test/xml'

import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const DEFAULT_DECLARATION = `xmlns="${DEFAULT_URI}"`
const EXT_DECLARATION = `xmlns:ext="${EXT_URI}"`
const XS_DECLARATION = `xmlns:xs="${XSD_NAMESPACE_URI}"`
const DECLARATION_PATTERN = /\sxmlns(?::[\w.-]+)?="[^"]*"/g
const ROOT_START_TAG_PATTERN = /<Root\b[^>]*>/

/** The declarations (`xmlns="…"`, `xmlns:p="…"`) of a text, in order of appearance. */
function declarationsOf(text: string): string[] {
	return [...text.matchAll(DECLARATION_PATTERN)].map((match) => match[0].trim())
}

/** The export of a case's document, compact. */
async function exportOf({
	project,
	source,
}: ActParams<TestDialecteConfig, BaseXmlTestCase>): Promise<string> {
	const { file } = await project.export({ documentId: source.documentId, indent: false })
	return file.text()
}

/** The stored value of an attribute of the first record of a tag, or the record's text when no name is given. */
async function storedValueOf(params: {
	source: ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
	tagName: 'EE_1' | 'EE_2'
	attribute?: string
}): Promise<string | undefined> {
	const { source, tagName, attribute } = params
	const root = await source.query.getRoot()
	const descendants = await source.query.findDescendants(root)
	const [record] = descendants[tagName] ?? []
	if (attribute === undefined) return record?.value
	const attributes: readonly { name: string; value: unknown }[] = record?.attributes ?? []
	const found = attributes.find((candidate) => candidate.name === attribute)
	return found === undefined ? undefined : String(found.value)
}

// ── Import: a QName value stored resolved, with the file's own bindings ──────

describe('import - a QName-typed value is stored in the engine form', () => {
	type TestCase = BaseXmlTestCase & {
		tagName: 'EE_1' | 'EE_2'
		/** The attribute read; absent, the record's text. */
		attribute?: string
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'a QName whose prefix the root binds to a foreign namespace → Clark': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><EE_1 aEE_1="f:Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: '{urn:f}Thing',
		},
		'a QName whose prefix an ancestor binds → Clark': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e" xmlns:f="urn:f"><EE_1 aEE_1="f:Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: '{urn:f}Thing',
		},
		'a QName whose prefix is bound to one namespace on the root and to another on the element → the element’s':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:a">
					<E aE="e"><EE_1 xmlns:f="urn:b" aEE_1="f:Thing"/></E>
				</Root>
			`,
				tagName: 'EE_1',
				attribute: 'aEE_1',
				expected: '{urn:b}Thing',
			},
		'an unprefixed QName under the dialecte default → local': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: 'Thing',
		},
		'an unprefixed QName under another default in force on the element → that namespace, Clark': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}">
					<E aE="e"><d:EE_1 xmlns="urn:g" aEE_1="Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: '{urn:g}Thing',
		},
		'a QName in the ext namespace under a document prefix → ext:local': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:x="${EXT_URI}">
					<E aE="e"><EE_1 aEE_1="x:Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: 'ext:Thing',
		},
		'a QName whose prefix neither the file nor the engine binds → kept as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="u:Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: 'u:Thing',
		},
		'a NOTATION of the dialecte default under a document prefix → local': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}">
					<E aE="e"><EE_1 aEE_1="Thing" bEE_1="d:nEE_2"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'bEE_1',
			expected: 'nEE_2',
		},
		'a list of QNames (ext attribute) → each item resolved': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_EXT_NAMESPACE} xmlns:f="urn:f" xmlns:q="${XSD_NAMESPACE_URI}">
					<E aE="e"><EE_1 aEE_1="Thing" ext:cEE_1=" f:a  q:integer Plain "/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'ext:cEE_1',
			expected: '{urn:f}a xs:integer Plain',
		},
		'QName text whose prefix the element binds → Clark': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e">
						<EE_1 aEE_1="Thing"/>
						<EE_2 xmlns:f="urn:f" aEE_2="12">f:Kind</EE_2>
					</E>
				</Root>
			`,
			tagName: 'EE_2',
			expected: '{urn:f}Kind',
		},
		'an EE_1 in the ext namespace (not its declaration’s) → its value is no declared QName: as written':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_EXT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><ext:EE_1 aEE_1="f:Thing"/></E>
				</Root>
			`,
				tagName: 'EE_1',
				attribute: 'aEE_1',
				expected: 'f:Thing',
			},
		'an attribute cEE_1 in a foreign namespace under the prefix ext → no declared QName: as written':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><EE_1 xmlns:ext="urn:other" aEE_1="Thing" ext:cEE_1="f:a"/></E>
				</Root>
			`,
				tagName: 'EE_1',
				attribute: 'ext:cEE_1',
				expected: 'f:a',
			},
		'a Clark name written in the file for a QName → no lexical QName: as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="{${EXT_URI}}Thing"/></E>
				</Root>
			`,
			tagName: 'EE_1',
			attribute: 'aEE_1',
			expected: `{${EXT_URI}}Thing`,
		},
		'a string attribute holding a colon → as written': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:f="urn:f">
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 aEE_2="12" bEE_2="f:Thing">Kind</EE_2></E>
				</Root>
			`,
			tagName: 'EE_2',
			attribute: 'bEE_2',
			expected: 'f:Thing',
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const { tagName, attribute } = testCase
			await expect(storedValueOf({ source, tagName, attribute })).resolves.toBe(testCase.expected)
		},
	})
})

// ── Export: the namespaces QName values use are declared on the root ─────────

describe('export - QName values declare their namespaces on the root', () => {
	type TestCase = BaseXmlTestCase & {
		/** The root's declarations, in order. */
		rootDeclarations: string[]
		/** Pieces of the written body, as written. */
		bodyContains: string[]
		/** XPath queries the export must satisfy (prefix `default` for the dialecte default). */
		queries?: string[]
	}

	const testCases: Record<string, TestCase> = {
		'a QName in a namespace only the file declared → ns1 on the root, the value written ns1:': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e" xmlns:f="urn:f"><EE_1 aEE_1="f:Thing"/></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, 'xmlns:ns1="urn:f"'],
			bodyContains: ['aEE_1="ns1:Thing"'],
			queries: ['//default:EE_1[namespace::ns1="urn:f"]'],
		},
		'QName text in a namespace only the file declared → ns1 on the root, the text written ns1:': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/><EE_2 xmlns:f="urn:f" aEE_2="12">f:Kind</EE_2></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, 'xmlns:ns1="urn:f"'],
			bodyContains: ['>ns1:Kind</EE_2>'],
		},
		'a list of QNames → xs and ns1 on the root, each item written with its prefix': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_EXT_NAMESPACE} xmlns:f="urn:f" xmlns:q="${XSD_NAMESPACE_URI}">
					<E aE="e"><EE_1 aEE_1="Thing" ext:cEE_1="f:a q:integer Plain"/></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, EXT_DECLARATION, XS_DECLARATION, 'xmlns:ns1="urn:f"'],
			bodyContains: ['ext:cEE_1="ns1:a xs:integer Plain"'],
		},
		'a QName of the dialecte default → written unprefixed, nothing more declared': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing"/></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION],
			bodyContains: ['aEE_1="Thing"'],
		},
		'a NOTATION of the dialecte default → written with the default namespace’s alias prefix': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="Thing" bEE_1="nEE_2"/></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, `xmlns:ns1="${DEFAULT_URI}"`],
			bodyContains: ['bEE_1="ns1:nEE_2"'],
		},
		'a QName whose prefix nothing binds → written as stored, declaring nothing': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<E aE="e"><EE_1 aEE_1="u:Thing"/></E>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION],
			bodyContains: ['aEE_1="u:Thing"'],
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			const rootStartTag = ROOT_START_TAG_PATTERN.exec(xml)?.[0] ?? ''
			const body = xml.slice(xml.indexOf(rootStartTag) + rootStartTag.length)
			expect(declarationsOf(rootStartTag)).toEqual(params.testCase.rootDeclarations)
			expect(declarationsOf(body)).toEqual([])
			for (const piece of params.testCase.bodyContains) expect(body).toContain(piece)
			for (const query of params.testCase.queries ?? []) {
				expect(
					withXmlDocument(
						{ xml, label: 'the export' },
						(document) =>
							selectNodes({
								context: document,
								expression: query,
								namespaces: { default: DEFAULT_URI },
							}).length,
					),
				).toBe(1)
			}
		},
	})
})

// ── A canonical document ─────────────────────────────────────────────────────

describe('export - a canonical document with QName values', () => {
	type TestCase = BaseXmlTestCase

	const testCases: Record<string, TestCase> = {
		'the compact export of every kind of QName value → the export is the same text': {
			sourceXml: `<?xml version="1.0" encoding="UTF-8"?><Root ${DEFAULT_DECLARATION} xmlns:ns2="${DEFAULT_URI}" ${EXT_DECLARATION} ${XS_DECLARATION} xmlns:ns1="urn:f"><E aE="e"><EE_1 aEE_1="ns1:Thing" bEE_1="ns2:nEE_1" ext:cEE_1="ns1:a xs:integer Plain"/><EE_2 aEE_2="12">ns1:Kind</EE_2></E></Root>`,
		},
		'the compact export of a QName of the xml prefix → the export is the same text, xml never declared':
			{
				sourceXml: `<?xml version="1.0" encoding="UTF-8"?><Root ${DEFAULT_DECLARATION}><E aE="e"><EE_1 aEE_1="xml:lang"/></E></Root>`,
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			await expect(exportOf(params)).resolves.toBe(params.testCase.sourceXml)
		},
	})
})
