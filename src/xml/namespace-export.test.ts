import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE, XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { selectFirstNode, withXmlDocument } from '@/test/xml'

import type { RefOrRecord } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { XmlElement } from '@/test/xml'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const XSI_URI = XSI_NAMESPACE.uri
const DEFAULT_DECLARATION = `xmlns="${DEFAULT_URI}"`
const XSI_DECLARATION = `xmlns:xsi="${XSI_URI}"`
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

/** The text before the root start tag's end, and what follows it. */
function splitAtRootStartTag(xml: string): { rootStartTag: string; body: string } {
	const rootStartTag = ROOT_START_TAG_PATTERN.exec(xml)?.[0] ?? ''
	return { rootStartTag, body: xml.slice(xml.indexOf(rootStartTag) + rootStartTag.length) }
}

// ── Declarations land on the root, and only there ────────────────────────────

describe('export - declarations on the root', () => {
	type TestCase = BaseXmlTestCase & {
		/** The root's declarations, in order. */
		rootDeclarations: string[]
		/** The declarations anywhere below the root start tag, in order. */
		belowRootDeclarations: string[]
		/** Pieces of the written body, as written. */
		bodyContains: string[]
	}

	const testCases: TestCases<TestCase> = {
		'xs:integer, xs declared on an ancestor → xs bound to XSD on the root': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
					<D aD="d" ${XS_DECLARATION}>
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, XSI_DECLARATION, XS_DECLARATION],
			belowRootDeclarations: [],
			bodyContains: ['xsi:type="xs:integer"'],
		},
		'xs:integer, xs declared nowhere → xs bound to XSD on the root': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
					<D aD="d">
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, XSI_DECLARATION, XS_DECLARATION],
			belowRootDeclarations: [],
			bodyContains: ['xsi:type="xs:integer"'],
		},
		't bound to urn:b on the first subtree and to urn:a on the next → t is urn:b, t2 is urn:a, the root lists t2 first (others by URI)':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
						<D aD="d">
							<DD_2 aDD_2="p">
								<DDD_2>
									<t:B xmlns:t="urn:b"> <DD_1 xsi:type="t:Kind" aDD_1="s"/> </t:B> <t:A xmlns:t="urn:a"/>
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				rootDeclarations: [
					DEFAULT_DECLARATION,
					XSI_DECLARATION,
					'xmlns:t2="urn:a"',
					'xmlns:t="urn:b"',
				],
				belowRootDeclarations: [],
				bodyContains: ['<t2:A/>', '<t:B>', 'xsi:type="t:Kind"', '</t:B>'],
			},
		't bound to the same urn:a on two subtrees → a single t, no t2': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<D aD="d">
						<DD_2 aDD_2="p">
							<DDD_2>
								<t:A xmlns:t="urn:a"/>
								<t:B xmlns:t="urn:a"/>
							</DDD_2>
						</DD_2>
					</D>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, 'xmlns:t="urn:a"'],
			belowRootDeclarations: [],
			bodyContains: ['<t:A/><t:B/>'],
		},
		'urn:a declared as p on one subtree and as q on another → a single p (the first stored), the q elements written p:':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE}>
					<D aD="d">
						<DD_2 aDD_2="p">
							<DDD_2>
								<p:A xmlns:p="urn:a"/>
								<q:B xmlns:q="urn:a"/>
							</DDD_2>
						</DD_2>
					</D>
				</Root>
			`,
				rootDeclarations: [DEFAULT_DECLARATION, 'xmlns:p="urn:a"'],
				belowRootDeclarations: [],
				bodyContains: ['<p:A/><p:B/>'],
			},
		'a type namespace no name uses → ns1 on the root, the value written with ns1': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
					<D aD="d" xmlns:k="urn:k">
						<DD_1 xsi:type="k:Kind" aDD_1="s"/>
					</D>
				</Root>
			`,
			rootDeclarations: [DEFAULT_DECLARATION, XSI_DECLARATION, 'xmlns:ns1="urn:k"'],
			belowRootDeclarations: [],
			bodyContains: ['xsi:type="ns1:Kind"'],
		},
		'a subtree default namespace → its elements written ns1:, the attribute unprefixed, the declaration on the root':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE}>
						<D aD="d">
							<DD_2 aDD_2="p">
								<DDD_2>
									<F xmlns="urn:f" fa="1">
										<X/>
									</F>
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				rootDeclarations: [DEFAULT_DECLARATION, 'xmlns:ns1="urn:f"'],
				belowRootDeclarations: [],
				bodyContains: ['<ns1:F fa="1"><ns1:X/></ns1:F>'],
			},
		'a no-namespace element under the defaulted root → xmlns="" on itself, the only declaration below the root':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE}>
						<D aD="d">
							<DD_2 aDD_2="p">
								<DDD_2>
									<N xmlns=""/>
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				rootDeclarations: [DEFAULT_DECLARATION],
				belowRootDeclarations: ['xmlns=""'],
				bodyContains: ['<N xmlns=""/>'],
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			const { rootStartTag, body } = splitAtRootStartTag(xml)
			expect(declarationsOf(rootStartTag)).toEqual(params.testCase.rootDeclarations)
			expect(declarationsOf(body)).toEqual(params.testCase.belowRootDeclarations)
			for (const piece of params.testCase.bodyContains) expect(body).toContain(piece)
		},
	})
})

// ── An xsi:type value is bound where it is written ───────────────────────────

describe('export - the xsi:type value of the exported DD_1', () => {
	type TestCase = BaseXmlTestCase & {
		expectedValue: string
		/** The namespace the value's prefix names on DD_1; null when nothing binds it. */
		expectedNamespace: string | null
	}

	const testCases: TestCases<TestCase> = {
		'xs:integer, xs declared on an ancestor → xs:integer bound to XSD': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
					<D aD="d" ${XS_DECLARATION}>
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			expectedValue: 'xs:integer',
			expectedNamespace: XSD_NAMESPACE_URI,
		},
		'xs:integer, xs declared nowhere → xs:integer bound to XSD': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION}>
					<D aD="d">
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			expectedValue: 'xs:integer',
			expectedNamespace: XSD_NAMESPACE_URI,
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			const { value, boundNamespace } = withXmlDocument(
				{ xml, label: 'the export' },
				function readType(document) {
					const shape = selectFirstNode({
						context: document,
						expression: '//default:DD_1',
						namespaces: { default: DEFAULT_URI },
					}) as XmlElement
					const typeValue =
						selectFirstNode({
							context: shape,
							expression: '@xsi:type',
							namespaces: { xsi: XSI_URI },
						})?.content ?? ''
					const prefix = typeValue.slice(0, typeValue.indexOf(':'))
					return { value: typeValue, boundNamespace: shape.namespaceForPrefix(prefix) }
				},
			)
			expect(value).toBe(params.testCase.expectedValue)
			expect(boundNamespace).toBe(params.testCase.expectedNamespace)
		},
	})
})

// ── The root's declaration order ─────────────────────────────────────────────

describe('export - the root start tag', () => {
	type TestCase = BaseXmlTestCase & { expectedRootStartTag: string }

	const testCases: TestCases<TestCase> = {
		'every kind of namespace used → xmlns, xsi, config namespaces, the others by URI, then the root attributes':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION} xmlns:zz="urn:a" xmlns:aa="urn:z" xmlns:oo="http://a.example/o" ${XMLNS_EXT_NAMESPACE} ${XS_DECLARATION} root="r" ext:root="e">
						<D aD="d">
							<DD_1 xsi:type="xs:integer" aDD_1="s"/>
							<DD_2 aDD_2="p">
								<DDD_2>
									<aa:B/> <zz:A/> <oo:C/>
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				expectedRootStartTag: `<Root ${DEFAULT_DECLARATION} ${XSI_DECLARATION} xmlns:ext="${EXT_URI}" xmlns:oo="http://a.example/o" ${XS_DECLARATION} xmlns:zz="urn:a" xmlns:aa="urn:z" ext:root="e" root="r">`,
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const xml = await exportOf(params)
			expect(splitAtRootStartTag(xml).rootStartTag).toBe(params.testCase.expectedRootStartTag)
		},
	})
})

// ── A fragment ───────────────────────────────────────────────────────────────

describe('export - a fragment written from a subtree', () => {
	type TestCase = BaseXmlTestCase

	const testCases: TestCases<TestCase> = {
		'subtree holding xs:integer and f:X → its start element declares xs, f and xsi, no descendant declares':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XSI_DECLARATION} ${XMLNS_DEV_NAMESPACE} xmlns:f="urn:f">
					<D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d-1" aD="d">
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
						<DD_2 aDD_2="p">
							<DDD_2>
								<f:X/>
							</DDD_2>
						</DD_2>
					</D>
				</Root>
			`,
				// xs, f and xsi in scope; no dev (the snapshot drops the custom ids, nothing else uses it); no descendant
				// declares anything (one in-scope namespace more than its parent)
				expectedQueries: [
					`/default:D[namespace::xs="${XSD_NAMESPACE_URI}"][namespace::f="urn:f"][namespace::xsi="${XSI_URI}"][not(namespace::dev)][not(.//*[count(namespace::*) > count(../namespace::*)])]`,
				],
			},
	}

	runTestCases.withExport<TestCase>({
		testCases,
		act: async ({ source }) => {
			const fragment = await source.query.getSnapshot({
				ref: { tagName: 'D', id: 'd-1' },
				as: 'xml',
			})
			return { assertOn: 'custom', xmlString: fragment }
		},
	})
})

// ── A fragment rooted at a no-namespace element ──────────────────────────────

describe('export - a fragment rooted at a no-namespace element', () => {
	type TestCase = BaseXmlTestCase

	// N is in no namespace: the dialecte's typed tag names do not hold it
	const noNamespaceRef = { tagName: 'N', id: 'n-1' } as unknown as RefOrRecord<
		TestDialecteConfig,
		'D'
	>

	const testCases: TestCases<TestCase> = {
		'N in no namespace holding a default-namespace child → no declaration on N, the child declares the default':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}>
						<D aD="d">
							<DD_2 aDD_2="p">
								<DDD_2>
									<N xmlns="" ${CUSTOM_RECORD_ID_ATTRIBUTE}="n-1">
										<A xmlns="${DEFAULT_URI}" aA="a"/>
									</N>
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				// N has only the XML namespace in scope; its child is in the default namespace, declared on itself
				expectedQueries: ['/N[count(namespace::*)=1]/default:A[namespace::*[name()=""]]'],
			},
	}

	runTestCases.withExport<TestCase>({
		testCases,
		act: async ({ source }) => {
			const fragment = await source.query.getSnapshot({
				ref: noNamespaceRef,
				as: 'xml',
			})
			expect(() => withXmlDocument({ xml: fragment, label: 'the fragment' }, () => 0)).not.toThrow()
			return { assertOn: 'custom', xmlString: fragment }
		},
	})
})

// ── A canonical document ─────────────────────────────────────────────────────

describe('export - a canonical document', () => {
	type TestCase = BaseXmlTestCase

	const testCases: TestCases<TestCase> = {
		'the compact export of every kind of namespace use → the export is the same text': {
			sourceXml: `<?xml version="1.0" encoding="UTF-8"?><Root ${DEFAULT_DECLARATION} ${XSI_DECLARATION} ${XS_DECLARATION} xmlns:t2="urn:a" xmlns:t="urn:b" xmlns:f="urn:f" xmlns:ns1="urn:g"><D aD="d"><DD_1 aDD_1="s" xsi:type="xs:integer"/><DD_2 aDD_2="p"><DDD_2><f:X/><t:B><DD_1 aDD_1="s" xsi:type="t:Kind"/></t:B><t2:A/><ns1:F fa="1"><ns1:G/></ns1:F><N xmlns=""/></DDD_2></DD_2></D></Root>`,
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async (params) => {
			const exported = await exportOf(params)
			expect(exported).toBe(params.testCase.sourceXml)
		},
	})
})
