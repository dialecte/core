import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE, XMLNS_XSI_NAMESPACE } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { selectNodes, withXmlDocument } from '@/test/xml'

import type { RefOrRecord } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestDialecteConfig } from '@/test'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri

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

// ── A name in no namespace under an element in a namespace ───────────────────

describe('export - a qualified name in no namespace on an element in a namespace', () => {
	type TestCase = BaseXmlTestCase & {
		/** Pieces of the export, as written. */
		contains: string[]
		/** XPath queries that each select exactly one node of the export. */
		queries: string[]
	}

	const testCases: Record<string, TestCase> = {
		'a QName value in no namespace (an xmlns="" subtree) → the element under the default’s alias, xmlns="" on it, the value unprefixed':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<d:E aE="e" xmlns=""><d:EE_1 aEE_1="Thing"/></d:E>
					</Root>
				`,
				contains: [`xmlns:ns1="${DEFAULT_URI}"`, '<ns1:EE_1 xmlns="" aEE_1="Thing"/>'],
				// EE_1 stays in the default namespace, and no default namespace is in scope where its value stands (libxml2
				// lists the xmlns="" undeclaration as a namespace node with an empty value)
				queries: ['//d:EE_1[@aEE_1="Thing"][not(namespace::*[name()=""][. != ""])]'],
			},
		'an xsi:type in no namespace (an xmlns="" subtree) → the element under the default’s alias, xmlns="" on it, the type unprefixed':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<d:D aD="d" xmlns=""><d:DD_1 aDD_1="s" xsi:type="Kind"/></d:D>
					</Root>
				`,
				contains: [`xmlns:ns1="${DEFAULT_URI}"`, '<ns1:DD_1 xmlns="" aDD_1="s" xsi:type="Kind"/>'],
				queries: ['//d:DD_1[@aDD_1="s"][not(namespace::*[name()=""][. != ""])]'],
			},
		'two nested default-namespace elements with an xsi:type in no namespace → both under the alias, xmlns="" on the outer only':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<d:D aD="d" xmlns=""><d:DD_1 aDD_1="s" xsi:type="Kind"><d:DDD_1 aDDD_1="t" xsi:type="Kind"/></d:DD_1></d:D>
					</Root>
				`,
				contains: [
					'<ns1:DD_1 xmlns="" aDD_1="s" xsi:type="Kind"><ns1:DDD_1 aDDD_1="t" xsi:type="Kind"/></ns1:DD_1>',
				],
				queries: ['//d:DDD_1[not(namespace::*[name()=""][. != ""])]'],
			},
		'an xsi:type in no namespace on an element in no namespace → written unprefixed, no second xmlns=""':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<E aE="e"><Foo xmlns=""><Bar xsi:type="Kind"/></Foo></E>
				</Root>
			`,
				contains: ['<Foo xmlns=""><Bar xsi:type="Kind"/></Foo>'],
				queries: ['//Foo/Bar[not(namespace::*[name()=""][. != ""])]'],
			},
		'an xsi:type in no namespace on the no-namespace element that undeclares the default → written unprefixed on it':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<E aE="e"><Foo xmlns="" xsi:type="Kind"/></E>
				</Root>
			`,
				contains: ['<Foo xmlns="" xsi:type="Kind"/>'],
				queries: ['//Foo[not(namespace::*[name()=""][. != ""])]'],
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

describe('export - a qualified name in no namespace survives the round trip', () => {
	type TestCase = BaseXmlTestCase

	const testCases: Record<string, TestCase> = {
		'the compact export of a QName value in no namespace → the export is the same text': {
			sourceXml: `<?xml version="1.0" encoding="UTF-8"?><Root xmlns="${DEFAULT_URI}" xmlns:ns1="${DEFAULT_URI}"><E aE="e"><ns1:EE_1 xmlns="" aEE_1="Thing"/></E></Root>`,
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			await expect(exportOf(params)).resolves.toBe(params.testCase.sourceXml)
		},
	})
})

// ── A name in no namespace on the writer's root ─────────────────────────────

describe('export - a qualified name in no namespace on the written root', () => {
	type TestCase = BaseXmlTestCase & {
		/** The fragment's start record. */
		fragment: { tagName: string; id: string }
		/** Pieces of the written text, as written. */
		contains: string[]
	}

	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const testCases: Record<string, TestCase> = {
		'a fragment whose start element holds a QName value in no namespace → under the alias, no default declared, the value unprefixed':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<d:E aE="e" xmlns=""><d:EE_1 ${customId}="ee1" aEE_1="Thing"/></d:E>
					</Root>
				`,
				fragment: { tagName: 'EE_1', id: 'ee1' },
				contains: [`<ns1:EE_1 xmlns:ns1="${DEFAULT_URI}"`, 'aEE_1="Thing"'],
				expectedQueries: ['/default:EE_1[@aEE_1="Thing"][not(namespace::*[name()=""][. != ""])]'],
			},
		'a fragment whose start element holds an xsi:type in no namespace → under the alias, its default-namespace child declares the default':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<d:D aD="d" xmlns="">
							<d:DD_1 ${customId}="dd1" aDD_1="s" xsi:type="Kind"><d:DDD_1 aDDD_1="t"/></d:DD_1>
						</d:D>
					</Root>
				`,
				fragment: { tagName: 'DD_1', id: 'dd1' },
				contains: ['<ns1:DD_1 ', 'xsi:type="Kind"', `<DDD_1 xmlns="${DEFAULT_URI}"`],
				expectedQueries: [
					'/default:DD_1[not(namespace::*[name()=""][. != ""])]',
					`/default:DD_1/default:DDD_1[namespace::*[name()=""]="${DEFAULT_URI}"]`,
				],
			},
		'an ext fragment with an xsi:type in no namespace on a default-namespace child → no default in force where the type stands, the other children keep their namespace':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_XSI_NAMESPACE} ${XMLNS_EXT_NAMESPACE} xmlns:d="${DEFAULT_URI}">
						<A aA="a">
							<ext:AA_3 ${customId}="aa3" aAA_3="s">
								<d:AAA_1 xmlns="" aAAA_1="t" xsi:type="Kind"/>
								<AAA_2 aAAA_2="u"/>
							</ext:AA_3>
						</A>
					</Root>
				`,
				fragment: { tagName: 'AA_3', id: 'aa3' },
				contains: ['xsi:type="Kind"'],
				expectedQueries: [
					'/ext:AA_3/default:AAA_1[not(namespace::*[name()=""][. != ""])]',
					'/ext:AA_3/default:AAA_2[@aAAA_2="u"]',
				],
			},
		'an ext fragment with an xsi:type in no namespace on an ext child, after a default-namespace child → no default in force where the type stands':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_XSI_NAMESPACE} ${XMLNS_EXT_NAMESPACE}>
						<A aA="a">
							<ext:AA_3 ${customId}="aa3" aAA_3="s">
								<AAA_1 aAAA_1="t"/>
								<ext:AAA_3 xmlns="" aAAA_3="v" xsi:type="Kind"/>
							</ext:AA_3>
						</A>
					</Root>
				`,
				fragment: { tagName: 'AA_3', id: 'aa3' },
				contains: ['xsi:type="Kind"'],
				expectedQueries: [
					'/ext:AA_3/default:AAA_1[@aAAA_1="t"]',
					'/ext:AA_3/ext:AAA_3[not(namespace::*[name()=""][. != ""])]',
				],
			},
	}

	runTestCases.withExport<TestCase>({
		testCases,
		act: async ({ source, testCase }): Promise<ActResult> => {
			const xmlString = await source.query.getSnapshot({
				// a tag of the definition, read by its custom id
				ref: testCase.fragment as unknown as RefOrRecord<TestDialecteConfig, 'E'>,
				as: 'xml',
			})
			for (const piece of testCase.contains) expect(xmlString).toContain(piece)
			return { assertOn: 'custom', xmlString }
		},
	})
})
