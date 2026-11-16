import { describe, expect } from 'vitest'

import { XMLNS_XSI_NAMESPACE, XSI_NAMESPACE } from '@/helpers/constant'
import { DIALECTE_TEST_NAMESPACES, runTestCases, XMLNS_DEFAULT_NAMESPACE } from '@/test'
import { selectFirstNode, withXmlDocument } from '@/test/xml'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { XmlElement } from '@/test/xml'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const XSI_URI = XSI_NAMESPACE.uri

/** The export of a case's document, compact. */
async function exportOf({
	project,
	source,
}: ActParams<TestDialecteConfig, BaseXmlTestCase>): Promise<string> {
	const { file } = await project.export({ documentId: source.documentId, indent: false })
	return file.text()
}

// ── What a name or a value means never changes on export ─────────────────────

describe('export - a name or value in the dialecte default namespace keeps its namespace', () => {
	type TestCase = BaseXmlTestCase & {
		/** XPath expressions (default and xsi prefixes) of the export: each must select a node. */
		exportedQueries: string[]
	}

	const testCases: TestCases<TestCase> = {
		'no default namespace declared, an unprefixed xsi:type tDD_2 → written tDD_2 with the dialecte default in scope':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_XSI_NAMESPACE}>
					<D aD="d">
						<DD_2 aDD_2="p" xsi:type="tDD_2"/>
					</D>
				</Root>
			`,
				exportedQueries: [
					`//default:DD_2[@xsi:type="tDD_2"][namespace::*[name()=""]="${DEFAULT_URI}"]`,
				],
			},
		'an attribute of the default namespace under a prefix re-bound below the root → still in the default namespace, the other one too':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}" xmlns:z="urn:z">
					<D aD="d" d:foo="x">
						<z:Q xmlns:d="urn:other" d:bar="y"/>
					</D>
				</Root>
			`,
				exportedQueries: [
					`//default:D/@*[local-name()="foo"][namespace-uri()="${DEFAULT_URI}"]`,
					`//*[local-name()="Q"]/@*[local-name()="bar"][namespace-uri()="urn:other"]`,
				],
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			withXmlDocument({ xml, label: 'the export' }, function checkQueries(document) {
				for (const expression of params.testCase.exportedQueries) {
					const node = selectFirstNode({
						context: document,
						expression,
						namespaces: { default: DEFAULT_URI, xsi: XSI_URI },
					})
					expect({ expression, found: node !== undefined && node !== null }).toEqual({
						expression,
						found: true,
					})
				}
			})
		},
	})
})

describe('export - a default-namespace attribute keeps its stored prefix', () => {
	type TestCase = BaseXmlTestCase & { exportedQueries: string[] }

	const testCases: TestCases<TestCase> = {
		'xmlns:d bound to the default namespace on the root, d:foo on a foreign element → xmlns:d declared on the root, the attribute written d:foo':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}" xmlns:z="urn:z">
					<D aD="d">
						<z:Q d:foo="x"/>
					</D>
				</Root>
			`,
				exportedQueries: [
					`/default:Root[namespace::*[name()="d"]="${DEFAULT_URI}"]//*[@*[name()="d:foo"][namespace-uri()="${DEFAULT_URI}"]]`,
				],
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			withXmlDocument({ xml, label: 'the export' }, function checkQueries(document) {
				for (const expression of params.testCase.exportedQueries) {
					const node = selectFirstNode({
						context: document,
						expression,
						namespaces: { default: DEFAULT_URI, xsi: XSI_URI },
					})
					expect({ expression, found: node !== undefined && node !== null }).toEqual({
						expression,
						found: true,
					})
				}
			})
		},
	})
})

describe('export - a default-namespace type on a no-namespace element', () => {
	type TestCase = BaseXmlTestCase & {
		/** The prefix pattern the value must carry: an alias, never unprefixed. */
		expectedValuePattern: RegExp
	}

	const testCases: TestCases<TestCase> = {
		'X in no namespace (xmlns="") with xsi:type d:tDD_2 → the value carries an ns<k> alias bound to the default namespace':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:d="${DEFAULT_URI}">
					<D aD="d">
						<X xmlns="" xsi:type="d:tDD_2"/>
					</D>
				</Root>
			`,
				expectedValuePattern: /^ns\d+:tDD_2$/,
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			const { value, boundNamespace } = withXmlDocument(
				{ xml, label: 'the export' },
				function readType(document) {
					const element = selectFirstNode({
						context: document,
						expression: '//X',
						namespaces: {},
					}) as XmlElement
					const typeValue =
						selectFirstNode({
							context: element,
							expression: '@xsi:type',
							namespaces: { xsi: XSI_URI },
						})?.content ?? ''
					const prefix = typeValue.includes(':') ? typeValue.slice(0, typeValue.indexOf(':')) : ''
					return { value: typeValue, boundNamespace: element.namespaceForPrefix(prefix) }
				},
			)
			expect(value).toMatch(params.testCase.expectedValuePattern)
			expect(boundNamespace).toBe(DEFAULT_URI)
		},
	})
})
