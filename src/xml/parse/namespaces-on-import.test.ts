import { parseXmlFile } from './parse-xml-document'

import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { XMLNS_NAMESPACE_URI, XMLNS_XSI_NAMESPACE, XSD_NAMESPACE_URI } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'

import type { ActParams, BaseTestCase, BaseXmlTestCase, TestDialecteConfig } from '@/test'

const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri

describe('import - namespace declarations', () => {
	type TestCase = BaseXmlTestCase

	const testCases: Record<string, TestCase> = {
		'declarations on the root → no record holds an xmlns attribute': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} ${XMLNS_EXT_NAMESPACE} xmlns:unused="urn:unused">
					<D aD="d">
						<DD_1 xsi:type="ext:tDD_1A" aDD_1="s"/>
					</D>
				</Root>
			`,
		},
		'declarations deep in the tree, used or not → no record holds an xmlns attribute': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<D aD="d" xmlns="${DIALECTE_TEST_NAMESPACES.default.uri}" xmlns:p="${EXT_URI}" xmlns:unused="urn:unused">
						<DD_1 xsi:type="p:tDD_1A" aDD_1="s" xmlns:also-unused="urn:also"/>
					</D>
				</Root>
			`,
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ source }) => {
			const root = await source.query.getRoot()
			const descendants = await source.query.findDescendants(root)
			const records = [root, ...Object.values(descendants).flat()]
			const declarations = records.flatMap((record) => {
				const attributes: readonly {
					name: string
					namespace?: { prefix: string; uri: string }
				}[] = record.attributes
				return attributes.filter(
					(attribute) =>
						attribute.name === 'xmlns' ||
						attribute.name.startsWith('xmlns:') ||
						attribute.namespace?.uri === XMLNS_NAMESPACE_URI ||
						attribute.namespace?.prefix === 'xmlns',
				)
			})
			expect(declarations).toEqual([])
		},
	})
})

describe('import - the xsi:type value is stored in the engine form', () => {
	type TestCase = BaseXmlTestCase & { expected: string }

	const testCases: Record<string, TestCase> = {
		'xs bound on the root → xs:integer': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:xs="${XSD_NAMESPACE_URI}">
					<D aD="d">
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: 'xs:integer',
		},
		'another prefix bound to the XSD namespace on an ancestor → xs:integer': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<D aD="d" xmlns:q="${XSD_NAMESPACE_URI}">
						<DD_1 xsi:type="q:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: 'xs:integer',
		},
		'prefix bound to one namespace on the root and to another on a subtree → the subtree namespace in Clark form':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:t="urn:a">
						<D aD="d" xmlns:t="urn:b">
							<DD_1 xsi:type="t:Kind" aDD_1="s"/>
						</D>
					</Root>
				`,
				expected: '{urn:b}Kind',
			},
		'unprefixed value under a subtree default namespace → that namespace in Clark form': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<D aD="d">
						<DD_1 xmlns="urn:f" xsi:type="Kind" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: '{urn:f}Kind',
		},
		'dialecte namespace bound to a document prefix → the config prefix': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:x="${EXT_URI}">
					<D aD="d">
						<DD_1 xsi:type="x:tDD_1A" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: 'ext:tDD_1A',
		},
		'xs declared nowhere → xs:integer': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<D aD="d">
						<DD_1 xsi:type="xs:integer" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: 'xs:integer',
		},
		'config prefix declared nowhere → the config prefix': {
			sourceXml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
					<D aD="d">
						<DD_1 xsi:type="ext:tDD_1A" aDD_1="s"/>
					</D>
				</Root>
			`,
			expected: 'ext:tDD_1A',
		},
		'no default namespace declared anywhere, an unprefixed value → the dialecte default type, tDD_2':
			{
				sourceXml: /* xml */ `
				<Root ${XMLNS_XSI_NAMESPACE}>
					<D aD="d">
						<DD_2 aDD_2="p" xsi:type="tDD_2"/>
					</D>
				</Root>
			`,
				expected: 'tDD_2',
			},
		'prefix t bound nowhere and unknown to the engine → t:Kind kept as written, the document opens':
			{
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}>
						<D aD="d">
							<DD_1 xsi:type="t:Kind" aDD_1="s"/>
						</D>
					</Root>
				`,
				expected: 't:Kind',
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ testCase, source }: ActParams<TestDialecteConfig, TestCase>) => {
			const root = await source.query.getRoot()
			const descendants = await source.query.findDescendants(root)
			const records = Object.values(descendants).flat()
			const values = await Promise.all(
				records.map((record) =>
					source.query.getAttribute(record, { name: 'xsi:type', defaults: 'none' }),
				),
			)
			const stored = values.filter((value) => value !== '')
			expect(stored).toEqual([testCase.expected])
		},
	})
})

describe('import - a declaration whose URI holds a character XML does not allow', () => {
	type TestCase = BaseTestCase & { file: File; expectedDetail: string }

	const testCases: Record<string, TestCase> = {
		'xmlns:ext holding a vertical tab (a character reference), used by nothing → PARSE_ERROR not-xml-character naming xmlns:ext':
			{
				file: new File(
					[
						/* xml */ `<Root xmlns="${DIALECTE_TEST_NAMESPACES.default.uri}"><A xmlns:ext="urn:&#11;"/></Root>`,
					],
					'declaration.xml',
				),
				expectedDetail: 'xmlns:ext',
			},
	}

	runTestCases.generic(testCases, async function expectRefused(testCase) {
		const thrown = await parseXmlFile({
			file: testCase.file,
			documentId: 'f1',
			configKey: 'test',
			store: { bulkWrite: async () => {}, writeSession: async () => {} },
			config: TEST_DIALECTE_CONFIG,
		}).then(
			function imported() {
				return undefined
			},
			function refused(error: unknown) {
				return error
			},
		)
		const error = toDialecteError(thrown)
		expect(error?.key).toBe('PARSE_ERROR')
		expect(error?.meta).toMatchObject({ reason: 'not-xml-character' })
		expect(error?.detail).toContain(testCase.expectedDetail)
	})
})
