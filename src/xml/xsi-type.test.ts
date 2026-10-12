import { describe, expect } from 'vitest'

import { matchesAttributeFilter } from '@/document'
import { CUSTOM_RECORD_ID_ATTRIBUTE, XMLNS_XSI_NAMESPACE, XSI_NAMESPACE } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { admittedXsiTypes, resolveXsiType } from '@/utils'

import type {
	ActParams,
	ActResult,
	BaseTestCase,
	BaseXmlTestCase,
	TestCases,
	TestDialecteConfig,
} from '@/test'
import type { ElementsOf, Namespace, RawRecord, TrackedRecord } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}`
const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri

describe('xsi:type - one stored form', () => {
	describe('import', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'type prefix bound only on an ancestor → canonical value, the variant attributes kept': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d" xmlns:p="${DEFAULT_URI}"><Shape xsi:type="p:tSquare" aShape="s" side="2"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="tSquare"][@side="2"]'],
			},
			'default namespace under the document own prefix → local name': {
				sourceXml: /* xml */ `<Root ${ns} xmlns:p="${DEFAULT_URI}"><D aD="d"><Shape xsi:type="p:tCircle" aShape="s" radius="3"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="tCircle"][@radius="3"]'],
			},
			'ext type under the document own prefix → dialecte prefix, its qualified attribute kept': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:e="${EXT_URI}"><D aD="d"><Shape xsi:type="e:tSquare" aShape="s" e:edge="5"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="ext:tSquare"][@ext:edge="5"]'],
			},
			'prefix bound nowhere → value kept as written': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><Shape xsi:type="q:tSquare" aShape="s"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="q:tSquare"]'],
			},
			'local name the default namespace lacks → kept, never read as another namespace type': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><Shape xsi:type="tTriangle" aShape="s"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="tTriangle"]'],
			},
			'declared type itself named → local name': {
				sourceXml: /* xml */ `<Root ${ns} xmlns:p="${DEFAULT_URI}"><D aD="d"><Plain xsi:type="p:tPlain" aPlain="p"/></D></Root>`,
				expectedQueries: ['//default:Plain[@xsi:type="tPlain"][@aPlain="p"]'],
			},
			'XSI namespace bound under another prefix → stored as xsi:type, the variant attributes kept':
				{
					sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:i="${XSI_NAMESPACE.uri}"><D aD="d"><Shape i:type="tSquare" aShape="s" side="2"/></D></Root>`,
					expectedQueries: ['//default:Shape[@xsi:type="tSquare"][@side="2"]'],
				},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async (): Promise<ActResult> => ({}),
		})
	})

	describe('export', () => {
		type TestCase = BaseXmlTestCase & {
			/** The xsi:type value expected on the exported Shape (any, when absent), and the namespace its prefix names there. */
			expectedValue?: string
			expectedNamespace: string
		}

		const testCases: TestCases<TestCase> = {
			'ext type the only use of its namespace → its prefix declared': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:e="${EXT_URI}"><D aD="d"><Shape xsi:type="e:tSquare" aShape="s"/></D></Root>`,
				expectedValue: 'ext:tSquare',
				expectedNamespace: EXT_URI,
			},
			'foreign ancestor re-binding the dialecte prefix → a prefix bound to the type namespace at the element':
				{
					sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}><D aD="d"><Anything><ext:Wrap xmlns:ext="urn:foreign" xmlns:e="${EXT_URI}"><Shape xsi:type="e:tSquare" aShape="s"/></ext:Wrap></Anything></D></Root>`,
					expectedNamespace: EXT_URI,
				},
			'root binds the dialecte prefix, a foreign ancestor shadows it → not the shadowed prefix': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} ${XMLNS_EXT_NAMESPACE}><D aD="d"><Anything ext:root="r"><ext:Wrap xmlns:ext="urn:foreign"><Shape xmlns:e="${EXT_URI}" xsi:type="e:tSquare" aShape="s"/></ext:Wrap></Anything></D></Root>`,
				expectedNamespace: EXT_URI,
			},
		}

		async function act({
			project,
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const { xmlDocument } = await project.export(source.documentId, { withDatabaseIds: false })
			const shape = xmlDocument.getElementsByTagNameNS(DEFAULT_URI, 'Shape')[0]
			const value = shape.getAttributeNS(XSI_NAMESPACE.uri, 'type') ?? ''
			if (testCase.expectedValue !== undefined) expect(value).toBe(testCase.expectedValue)
			const prefix = value.includes(':') ? value.slice(0, value.indexOf(':')) : null
			expect(shape.lookupNamespaceURI(prefix)).toBe(testCase.expectedNamespace)
		}

		runTestCases.withoutExport<TestCase>({ testCases, act })
	})

	describe('create', () => {
		type TestCase = BaseXmlTestCase & { xsiType: string }

		const sourceXml = /* xml */ `<Root ${ns}><D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d" aD="d"/></Root>`

		const testCases: TestCases<TestCase> = {
			'Clark name of an ext type → dialecte prefix': {
				sourceXml,
				xsiType: `{${EXT_URI}}tSquare`,
				expectedQueries: ['//default:Shape[@xsi:type="ext:tSquare"]'],
			},
			'Clark name of a default-namespace type → local name': {
				sourceXml,
				xsiType: `{${DEFAULT_URI}}tCircle`,
				expectedQueries: ['//default:Shape[@xsi:type="tCircle"]'],
			},
			'dialecte prefix → kept': {
				sourceXml,
				xsiType: 'ext:tSquare',
				expectedQueries: ['//default:Shape[@xsi:type="ext:tSquare"]'],
			},
			'local name the default namespace admits → local name': {
				sourceXml,
				xsiType: 'tSquare',
				expectedQueries: ['//default:Shape[@xsi:type="tSquare"]'],
			},
			'local name the default namespace lacks → kept, never read as another namespace type': {
				sourceXml,
				xsiType: 'tTriangle',
				expectedQueries: ['//default:Shape[@xsi:type="tTriangle"]'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			await source.transaction(async (tx) => {
				await tx.addChild(
					{ tagName: 'D', id: 'd' },
					{
						tagName: 'Shape',
						attributes: [
							{ name: 'aShape', value: 's' },
							{ name: 'type', value: testCase.xsiType, namespace: XSI_NAMESPACE },
						],
					},
				)
			})
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('clone', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'a stored value the default namespace lacks → copied as it is': {
				sourceXml: /* xml */ `<Root ${ns}><D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d" aD="d"><Shape ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tTriangle" aShape="s"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="tTriangle"][2]'],
				unexpectedQueries: ['//default:Shape[@xsi:type="ext:tTriangle"]'],
			},
		}

		async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const tree = await source.query.getTree({ tagName: 'Shape', id: 's' })
			await source.transaction(async (tx) => {
				if (tree) await tx.deepClone({ tagName: 'D', id: 'd' }, tree)
			})
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('update', () => {
		type TestCase = BaseXmlTestCase & { xsiType: string }

		const sourceXml = /* xml */ `<Root ${ns}><D aD="d"><Shape ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tCircle" aShape="s"/></D></Root>`

		const testCases: TestCases<TestCase> = {
			'Clark name of an ext type → dialecte prefix': {
				sourceXml,
				xsiType: `{${EXT_URI}}tTriangle`,
				expectedQueries: ['//default:Shape[@xsi:type="ext:tTriangle"]'],
			},
			'local name the default namespace lacks → kept, never read as another namespace type': {
				sourceXml,
				xsiType: 'tTriangle',
				expectedQueries: ['//default:Shape[@xsi:type="tTriangle"]'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			await source.transaction(async (tx) => {
				await tx.update(
					{ tagName: 'Shape', id: 's' },
					{ attributes: { 'xsi:type': testCase.xsiType } },
				)
			})
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('hook', () => {
		/** Names a Clark-named type on every Shape, after standardizing. */
		function withShapeType<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
			record: RawRecord<TestDialecteConfig, GenericElement>
		}): RawRecord<TestDialecteConfig, GenericElement> {
			const { record } = params
			if (record.tagName !== 'Shape') return record
			const xsiType = { name: 'xsi:type', value: `{${EXT_URI}}tSquare`, namespace: XSI_NAMESPACE }
			return { ...record, attributes: [...record.attributes, xsiType] } as RawRecord<
				TestDialecteConfig,
				GenericElement
			>
		}

		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'afterStandardizedRecord sets a Clark name → stored canonical': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><Shape aShape="s"/></D></Root>`,
				expectedQueries: ['//default:Shape[@xsi:type="ext:tSquare"]'],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			hooks: { afterStandardizedRecord: withShapeType },
			act: async (): Promise<ActResult> => ({}),
		})
	})

	describe('filter', () => {
		type TestCase = BaseXmlTestCase & {
			xsiType: string | string[]
			expectedShapes: string[]
		}

		const sourceXml = /* xml */ `<Root ${ns}><D aD="d"><Shape xsi:type="tSquare" aShape="square" side="1"/><Shape xsi:type="ext:tSquare" aShape="ext-square"/><Shape xsi:type="ext:tTriangle" aShape="triangle"/><Shape xsi:type="tCircle" aShape="circle"/></D></Root>`

		const testCases: TestCases<TestCase> = {
			'local name → the default-namespace type only': {
				sourceXml,
				xsiType: 'tSquare',
				expectedShapes: ['square'],
			},
			'dialecte prefix → that namespace type': {
				sourceXml,
				xsiType: 'ext:tSquare',
				expectedShapes: ['ext-square'],
			},
			'Clark name → that type': {
				sourceXml,
				xsiType: `{${EXT_URI}}tSquare`,
				expectedShapes: ['ext-square'],
			},
			'local name the default namespace lacks → no type of another namespace': {
				sourceXml,
				xsiType: 'tTriangle',
				expectedShapes: [],
			},
			'dialecte prefix of a type only another namespace has → that type': {
				sourceXml,
				xsiType: 'ext:tTriangle',
				expectedShapes: ['triangle'],
			},
			'several forms → any of them': {
				sourceXml,
				xsiType: ['tCircle', `{${DEFAULT_URI}}tSquare`],
				expectedShapes: ['square', 'circle'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const shapes = await source.query.findByAttributes({
				tagName: 'Shape',
				attributes: { 'xsi:type': testCase.xsiType },
			})
			const names = shapes.map(
				(shape) => shape.attributes.find((attribute) => attribute.name === 'aShape')?.value,
			)
			expect(names.sort()).toEqual([...testCase.expectedShapes].sort())
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('filter on a value stored as written', () => {
		type TestCase = BaseTestCase & {
			record: TrackedRecord<TestDialecteConfig, 'Shape'>
			xsiType: string
			expected: boolean
		}

		/** A Shape an earlier core stored with the document own prefix, bound on the record. */
		const storedAsWritten = {
			id: 'shape',
			tagName: 'Shape',
			namespace: DIALECTE_TEST_NAMESPACES.default,
			attributes: [
				{ name: 'aShape', value: 's' },
				{ name: 'xsi:type', value: 'p:tSquare', namespace: XSI_NAMESPACE },
				{
					name: 'p',
					value: DEFAULT_URI,
					namespace: { prefix: 'xmlns', uri: 'http://www.w3.org/2000/xmlns/' },
				},
			],
			value: '',
			parent: { id: 'd', tagName: 'D' },
			children: [],
			status: 'unchanged',
		} as unknown as TrackedRecord<TestDialecteConfig, 'Shape'>

		runTestCases.generic<TestCase>(
			{
				'its canonical form → matches': {
					record: storedAsWritten,
					xsiType: 'tSquare',
					expected: true,
				},
				'another type → no match': {
					record: storedAsWritten,
					xsiType: 'ext:tSquare',
					expected: false,
				},
			},
			(testCase) => {
				const matches = matchesAttributeFilter({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					record: testCase.record,
					attributeFilter: { 'xsi:type': testCase.xsiType },
				})
				expect(matches).toBe(testCase.expected)
			},
		)
	})

	describe('resolveXsiType', () => {
		type TestCase = BaseTestCase & {
			attributes: { name: string; value: string; namespace?: Namespace }[]
			expected: { clark: string; namespace: string; local: string } | undefined
		}

		const xsiType = (value: string) => ({ name: 'xsi:type', value, namespace: XSI_NAMESPACE })

		runTestCases.generic<TestCase>(
			{
				'local name → the default-namespace type': {
					attributes: [xsiType('tCircle')],
					expected: { clark: `{${DEFAULT_URI}}tCircle`, namespace: DEFAULT_URI, local: 'tCircle' },
				},
				'dialecte prefix → that namespace type': {
					attributes: [xsiType('ext:tSquare')],
					expected: { clark: `{${EXT_URI}}tSquare`, namespace: EXT_URI, local: 'tSquare' },
				},
				'prefix bound on the record → read there': {
					attributes: [
						xsiType('p:tSquare'),
						{
							name: 'p',
							value: DEFAULT_URI,
							namespace: { prefix: 'xmlns', uri: 'http://www.w3.org/2000/xmlns/' },
						},
					],
					expected: { clark: `{${DEFAULT_URI}}tSquare`, namespace: DEFAULT_URI, local: 'tSquare' },
				},
				'prefix bound nowhere → none': { attributes: [xsiType('q:tSquare')], expected: undefined },
				'no xsi:type → none': { attributes: [], expected: undefined },
			},
			(testCase) => {
				const record = { tagName: 'Shape', attributes: testCase.attributes }
				expect(resolveXsiType({ dialecteConfig: TEST_DIALECTE_CONFIG, record })).toEqual(
					testCase.expected,
				)
			},
		)
	})

	describe('admittedXsiTypes', () => {
		type TestCase = BaseTestCase & { tagName: 'Shape' | 'Plain' | 'Locked'; expected: string[] }

		runTestCases.generic<TestCase>(
			{
				'abstract declared type → its variants only': {
					tagName: 'Shape',
					expected: [
						`{${DEFAULT_URI}}tCircle`,
						`{${DEFAULT_URI}}tSquare`,
						`{${EXT_URI}}tSquare`,
						`{${EXT_URI}}tTriangle`,
					],
				},
				'concrete declared type → itself and its variants': {
					tagName: 'Plain',
					expected: [`{${DEFAULT_URI}}tPlain`, `{${DEFAULT_URI}}tPlainExt`],
				},
				'derivation blocked → the declared type only': {
					tagName: 'Locked',
					expected: [`{${DEFAULT_URI}}tLocked`],
				},
			},
			(testCase) => {
				const record = {
					tagName: testCase.tagName,
					attributes: [],
					parent: { id: 'd', tagName: 'D' as const },
				}
				const admitted = admittedXsiTypes({ dialecteConfig: TEST_DIALECTE_CONFIG, record })
				expect([...admitted].sort()).toEqual([...testCase.expected].sort())
			},
		)
	})
})
