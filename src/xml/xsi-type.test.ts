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
import type {
	AttributesValueObjectOf,
	ElementsOf,
	Namespace,
	RawRecord,
	TrackedRecord,
} from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}`
const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const EXT = DIALECTE_TEST_NAMESPACES.ext

/**
 * The xsi:type values the types offer for DD_1: the stored literals. Some cases below hand the runtime another form of
 * the same type - a Clark name, a prefix the document binds - to prove it resolves them: typed as what they stand for.
 */
type StoredXsiTypeOfDD_1 = NonNullable<
	AttributesValueObjectOf<TestDialecteConfig, 'DD_1'>['xsi:type']
>

describe('xsi:type - one stored form', () => {
	describe('import', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'type prefix bound only on an ancestor → canonical value, the variant attributes kept': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d" xmlns:p="${DEFAULT_URI}"><DD_1 xsi:type="p:tDD_1A" aDD_1="s" dDD_1="2"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1A"][@dDD_1="2"]'],
			},
			'default namespace under the document own prefix → local name': {
				sourceXml: /* xml */ `<Root ${ns} xmlns:p="${DEFAULT_URI}"><D aD="d"><DD_1 xsi:type="p:tDD_1B" aDD_1="s" eDD_1="3"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1B"][@eDD_1="3"]'],
			},
			'ext type under the document own prefix → dialecte prefix, its qualified attribute kept': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:e="${EXT_URI}"><D aD="d"><DD_1 xsi:type="e:tDD_1A" aDD_1="s" e:dDD_1="5"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="ext:tDD_1A"][@ext:dDD_1="5"]'],
			},
			'prefix bound nowhere → value kept as written': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><DD_1 xsi:type="q:tDD_1A" aDD_1="s"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="q:tDD_1A"]'],
			},
			'local name the default namespace lacks → kept, never read as another namespace type': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><DD_1 xsi:type="tDD_1C" aDD_1="s"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1C"]'],
			},
			'declared type itself named → local name': {
				sourceXml: /* xml */ `<Root ${ns} xmlns:p="${DEFAULT_URI}"><D aD="d"><DD_2 xsi:type="p:tDD_2" aDD_2="p"/></D></Root>`,
				expectedQueries: ['//default:DD_2[@xsi:type="tDD_2"][@aDD_2="p"]'],
			},
			'XSI namespace bound under another prefix → stored as xsi:type, the variant attributes kept':
				{
					sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:i="${XSI_NAMESPACE.uri}"><D aD="d"><DD_1 i:type="tDD_1A" aDD_1="s" dDD_1="2"/></D></Root>`,
					expectedQueries: ['//default:DD_1[@xsi:type="tDD_1A"][@dDD_1="2"]'],
				},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async (): Promise<ActResult> => ({}),
		})
	})

	describe('export', () => {
		type TestCase = BaseXmlTestCase & {
			/** The xsi:type value expected on the exported DD_1 (any, when absent), and the namespace its prefix names there. */
			expectedValue?: string
			expectedNamespace: string
		}

		const testCases: TestCases<TestCase> = {
			'ext type the only use of its namespace → its prefix declared': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} xmlns:e="${EXT_URI}"><D aD="d"><DD_1 xsi:type="e:tDD_1A" aDD_1="s"/></D></Root>`,
				expectedValue: 'ext:tDD_1A',
				expectedNamespace: EXT_URI,
			},
			'foreign ancestor re-binding the dialecte prefix → a prefix bound to the type namespace at the element':
				{
					sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}><D aD="d"><DD_2 aDD_2="p"><DDD_2><ext:Wrap xmlns:ext="urn:foreign" xmlns:e="${EXT_URI}"><DD_1 xsi:type="e:tDD_1A" aDD_1="s"/></ext:Wrap></DDD_2></DD_2></D></Root>`,
					expectedNamespace: EXT_URI,
				},
			'root binds the dialecte prefix, a foreign ancestor shadows it → not the shadowed prefix': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_XSI_NAMESPACE} ${XMLNS_EXT_NAMESPACE}><D aD="d"><DD_2 aDD_2="p"><DDD_2 ext:root="r"><ext:Wrap xmlns:ext="urn:foreign"><DD_1 xmlns:e="${EXT_URI}" xsi:type="e:tDD_1A" aDD_1="s"/></ext:Wrap></DDD_2></DD_2></D></Root>`,
				expectedNamespace: EXT_URI,
			},
		}

		async function act({
			project,
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const { xmlDocument } = await project.export(source.documentId, { withDatabaseIds: false })
			const shape = xmlDocument.getElementsByTagNameNS(DEFAULT_URI, 'DD_1')[0]
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
				xsiType: `{${EXT_URI}}tDD_1A`,
				expectedQueries: ['//default:DD_1[@xsi:type="ext:tDD_1A"]'],
			},
			'Clark name of a default-namespace type → local name': {
				sourceXml,
				xsiType: `{${DEFAULT_URI}}tDD_1B`,
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1B"]'],
			},
			'dialecte prefix → kept': {
				sourceXml,
				xsiType: 'ext:tDD_1A',
				expectedQueries: ['//default:DD_1[@xsi:type="ext:tDD_1A"]'],
			},
			'local name the default namespace admits → local name': {
				sourceXml,
				xsiType: 'tDD_1A',
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1A"]'],
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
						tagName: 'DD_1',
						attributes: [
							{ name: 'aDD_1', value: 's' },
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
			'a stored value the element may not take → the clone is refused, the value never read as another type':
				{
					sourceXml: /* xml */ `<Root ${ns}><D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d" aD="d"><DD_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tDD_1C" aDD_1="s"/></D></Root>`,
					expectedQueries: ['//default:DD_1[@xsi:type="tDD_1C"]'],
					unexpectedQueries: ['//default:DD_1[2]', '//default:DD_1[@xsi:type="ext:tDD_1C"]'],
				},
		}

		async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const tree = await source.query.getTree({ tagName: 'DD_1', id: 's' })
			const cloned = source.transaction(async (tx) => {
				if (tree) await tx.deepClone({ tagName: 'D', id: 'd' }, tree)
			})
			await expect(cloned).rejects.toMatchObject({ cause: { key: 'XSI_TYPE_NOT_ADMITTED' } })
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('update', () => {
		type TestCase = BaseXmlTestCase & { xsiType: string }

		const sourceXml = /* xml */ `<Root ${ns}><D aD="d"><DD_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tDD_1B" aDD_1="s"/></D></Root>`

		const testCases: TestCases<TestCase> = {
			'Clark name of an ext type → dialecte prefix': {
				sourceXml,
				xsiType: `{${EXT_URI}}tDD_1C`,
				expectedQueries: ['//default:DD_1[@xsi:type="ext:tDD_1C"]'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			await source.transaction(async (tx) => {
				await tx.update(
					{ tagName: 'DD_1', id: 's' },
					{ attributes: { 'xsi:type': testCase.xsiType as StoredXsiTypeOfDD_1 } },
				)
			})
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('hook', () => {
		/** Names a Clark-named type on every DD_1, after standardizing. */
		function withVariantType<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
			record: RawRecord<TestDialecteConfig, GenericElement>
		}): RawRecord<TestDialecteConfig, GenericElement> {
			const { record } = params
			if (record.tagName !== 'DD_1') return record
			const xsiType = { name: 'xsi:type', value: `{${EXT_URI}}tDD_1A`, namespace: XSI_NAMESPACE }
			return { ...record, attributes: [...record.attributes, xsiType] } as RawRecord<
				TestDialecteConfig,
				GenericElement
			>
		}

		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'afterStandardizedRecord sets a Clark name → stored canonical': {
				sourceXml: /* xml */ `<Root ${ns}><D aD="d"><DD_1 aDD_1="s"/></D></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="ext:tDD_1A"]'],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			hooks: { afterStandardizedRecord: withVariantType },
			act: async (): Promise<ActResult> => ({}),
		})
	})

	describe('filter', () => {
		type TestCase = BaseXmlTestCase & {
			xsiType: string | string[]
			expectedShapes: string[]
		}

		const sourceXml = /* xml */ `<Root ${ns}><D aD="d"><DD_1 xsi:type="tDD_1A" aDD_1="square" dDD_1="1"/><DD_1 xsi:type="ext:tDD_1A" aDD_1="ext-square"/><DD_1 xsi:type="ext:tDD_1C" aDD_1="triangle"/><DD_1 xsi:type="tDD_1B" aDD_1="circle"/></D></Root>`

		const testCases: TestCases<TestCase> = {
			'local name → the default-namespace type only': {
				sourceXml,
				xsiType: 'tDD_1A',
				expectedShapes: ['square'],
			},
			'dialecte prefix → that namespace type': {
				sourceXml,
				xsiType: 'ext:tDD_1A',
				expectedShapes: ['ext-square'],
			},
			'Clark name → that type': {
				sourceXml,
				xsiType: `{${EXT_URI}}tDD_1A`,
				expectedShapes: ['ext-square'],
			},
			'local name the default namespace lacks → no type of another namespace': {
				sourceXml,
				xsiType: 'tDD_1C',
				expectedShapes: [],
			},
			'dialecte prefix of a type only another namespace has → that type': {
				sourceXml,
				xsiType: 'ext:tDD_1C',
				expectedShapes: ['triangle'],
			},
			'several forms → any of them': {
				sourceXml,
				xsiType: ['tDD_1B', `{${DEFAULT_URI}}tDD_1A`],
				expectedShapes: ['square', 'circle'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const shapes = await source.query.findByAttributes({
				tagName: 'DD_1',
				attributes: {
					'xsi:type': testCase.xsiType as StoredXsiTypeOfDD_1 | StoredXsiTypeOfDD_1[],
				},
			})
			const names = shapes.map(
				(shape) => shape.attributes.find((attribute) => attribute.name === 'aDD_1')?.value,
			)
			expect(names.sort()).toEqual([...testCase.expectedShapes].sort())
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('filter on a value stored as written', () => {
		type TestCase = BaseTestCase & {
			record: TrackedRecord<TestDialecteConfig, 'DD_1'>
			xsiType: string
			expected: boolean
		}

		/** A DD_1 an earlier core stored with the document own prefix, bound on the record. */
		const storedAsWritten = {
			id: 'shape',
			tagName: 'DD_1',
			namespace: DIALECTE_TEST_NAMESPACES.default,
			attributes: [
				{ name: 'aDD_1', value: 's' },
				{ name: 'xsi:type', value: 'p:tDD_1A', namespace: XSI_NAMESPACE },
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
		} as unknown as TrackedRecord<TestDialecteConfig, 'DD_1'>

		runTestCases.generic<TestCase>(
			{
				'its canonical form → matches': {
					record: storedAsWritten,
					xsiType: 'tDD_1A',
					expected: true,
				},
				'another type → no match': {
					record: storedAsWritten,
					xsiType: 'ext:tDD_1A',
					expected: false,
				},
			},
			(testCase) => {
				const matches = matchesAttributeFilter({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					record: testCase.record,
					attributeFilter: { 'xsi:type': testCase.xsiType as StoredXsiTypeOfDD_1 },
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

		/** An xsi:type attribute as core stores it. */
		function xsiType(value: string): { name: string; value: string; namespace: Namespace } {
			return { name: 'xsi:type', value, namespace: XSI_NAMESPACE }
		}

		runTestCases.generic<TestCase>(
			{
				'local name → the default-namespace type': {
					attributes: [xsiType('tDD_1B')],
					expected: { clark: `{${DEFAULT_URI}}tDD_1B`, namespace: DEFAULT_URI, local: 'tDD_1B' },
				},
				'dialecte prefix → that namespace type': {
					attributes: [xsiType('ext:tDD_1A')],
					expected: { clark: `{${EXT_URI}}tDD_1A`, namespace: EXT_URI, local: 'tDD_1A' },
				},
				'prefix bound on the record → read there': {
					attributes: [
						xsiType('p:tDD_1A'),
						{
							name: 'p',
							value: DEFAULT_URI,
							namespace: { prefix: 'xmlns', uri: 'http://www.w3.org/2000/xmlns/' },
						},
					],
					expected: { clark: `{${DEFAULT_URI}}tDD_1A`, namespace: DEFAULT_URI, local: 'tDD_1A' },
				},
				'prefix bound nowhere → none': { attributes: [xsiType('q:tDD_1A')], expected: undefined },
				'no xsi:type → none': { attributes: [], expected: undefined },
			},
			(testCase) => {
				const record = { tagName: 'DD_1', attributes: testCase.attributes }
				expect(resolveXsiType({ dialecteConfig: TEST_DIALECTE_CONFIG, record })).toEqual(
					testCase.expected,
				)
			},
		)
	})

	describe('admittedXsiTypes', () => {
		type TestCase = BaseTestCase & { tagName: 'DD_1' | 'DD_2' | 'DD_3'; expected: string[] }

		runTestCases.generic<TestCase>(
			{
				'abstract declared type → its variants only': {
					tagName: 'DD_1',
					expected: [
						`{${DEFAULT_URI}}tDD_1B`,
						`{${DEFAULT_URI}}tDD_1A`,
						`{${EXT_URI}}tDD_1A`,
						`{${EXT_URI}}tDD_1C`,
					],
				},
				'concrete declared type → itself and its variants': {
					tagName: 'DD_2',
					expected: [`{${DEFAULT_URI}}tDD_2`, `{${DEFAULT_URI}}tDD_2A`],
				},
				'derivation blocked → the declared type only': {
					tagName: 'DD_3',
					expected: [`{${EXT_URI}}tDD_3`],
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

	describe('write rules - create', () => {
		type TestCase = BaseXmlTestCase & {
			tagName: 'DD_1' | 'DD_2' | 'DD_3'
			attributes: { name: string; value: string; namespace?: Namespace }[]
			/** The key of the error the write is refused with; none when it is accepted. */
			refusedWith?: string
		}

		const sourceXml = /* xml */ `<Root ${ns}><D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d" aD="d"/></Root>`
		/** An xsi:type attribute in the array form of a write: the local name, its namespace. */
		function xsiType(value: string): { name: string; value: string; namespace: Namespace } {
			return { name: 'type', value, namespace: XSI_NAMESPACE }
		}

		const testCases: TestCases<TestCase> = {
			'abstract declared type, no xsi:type → XSI_TYPE_REQUIRED': {
				sourceXml,
				tagName: 'DD_1',
				attributes: [{ name: 'aDD_1', value: 's' }],
				refusedWith: 'XSI_TYPE_REQUIRED',
			},
			'a type the declaration does not admit → XSI_TYPE_NOT_ADMITTED': {
				sourceXml,
				tagName: 'DD_1',
				attributes: [{ name: 'aDD_1', value: 's' }, xsiType('tDD_2')],
				refusedWith: 'XSI_TYPE_NOT_ADMITTED',
			},
			'the abstract declared type itself → XSI_TYPE_NOT_ADMITTED': {
				sourceXml,
				tagName: 'DD_1',
				attributes: [{ name: 'aDD_1', value: 's' }, xsiType('tDD_1')],
				refusedWith: 'XSI_TYPE_NOT_ADMITTED',
			},
			'a prefix bound nowhere → XSI_TYPE_NOT_ADMITTED': {
				sourceXml,
				tagName: 'DD_1',
				attributes: [{ name: 'aDD_1', value: 's' }, xsiType('q:tDD_1A')],
				refusedWith: 'XSI_TYPE_NOT_ADMITTED',
			},
			'a local name the default namespace lacks → XSI_TYPE_NOT_ADMITTED, never read as another namespace type':
				{
					sourceXml,
					tagName: 'DD_1',
					attributes: [{ name: 'aDD_1', value: 's' }, xsiType('tDD_1C')],
					refusedWith: 'XSI_TYPE_NOT_ADMITTED',
				},
			'a derivation the type blocks → XSI_TYPE_NOT_ADMITTED': {
				sourceXml,
				tagName: 'DD_3',
				attributes: [{ name: 'aDD_3', value: 'l', namespace: EXT }, xsiType('ext:tDD_3A')],
				refusedWith: 'XSI_TYPE_NOT_ADMITTED',
			},
			'a variant of the abstract type → accepted': {
				sourceXml,
				tagName: 'DD_1',
				attributes: [
					{ name: 'aDD_1', value: 's' },
					{ name: 'dDD_1', value: '1' },
					xsiType('tDD_1A'),
				],
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1A"]'],
			},
			'the concrete declared type named → accepted': {
				sourceXml,
				tagName: 'DD_2',
				attributes: [{ name: 'aDD_2', value: 'p' }, xsiType('tDD_2')],
				expectedQueries: ['//default:DD_2[@xsi:type="tDD_2"]'],
			},
			'a concrete declared type, no xsi:type → accepted': {
				sourceXml,
				tagName: 'DD_2',
				attributes: [{ name: 'aDD_2', value: 'p' }],
				expectedQueries: ['//default:DD_2[@aDD_2="p"]'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const written = source.transaction(async (tx) => {
				await tx.addChild({ tagName: 'D', id: 'd' }, {
					tagName: testCase.tagName,
					attributes: testCase.attributes,
				} as never)
			})
			if (testCase.refusedWith === undefined) await written
			else await expect(written).rejects.toMatchObject({ cause: { key: testCase.refusedWith } })
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('write rules - update', () => {
		type TestCase = BaseXmlTestCase & {
			attributes: Record<string, string | undefined>
			refusedWith?: string
			/** What the refusal names: the attributes and children the new type does not admit. */
			leftOver?: { attributes: string[]; children: string[] }
		}

		const square = /* xml */ `<Root ${ns}><D aD="d"><DD_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tDD_1A" aDD_1="s" dDD_1="2"/></D></Root>`
		const squareWithCorner = /* xml */ `<Root ${ns}><D aD="d"><DD_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tDD_1A" aDD_1="s"><DDD_1 aDDD_1="c"/></DD_1></D></Root>`

		const testCases: TestCases<TestCase> = {
			'a type the element may not take → XSI_TYPE_NOT_ADMITTED': {
				sourceXml: square,
				attributes: { 'xsi:type': 'tDD_2' },
				refusedWith: 'XSI_TYPE_NOT_ADMITTED',
			},
			'a local name the default namespace lacks → XSI_TYPE_NOT_ADMITTED, never read as another namespace type':
				{
					sourceXml: square,
					attributes: { 'xsi:type': 'tDD_1C' },
					refusedWith: 'XSI_TYPE_NOT_ADMITTED',
				},
			'xsi:type removed where the declared type is abstract → XSI_TYPE_REQUIRED': {
				sourceXml: square,
				attributes: { 'xsi:type': undefined, dDD_1: undefined },
				refusedWith: 'XSI_TYPE_REQUIRED',
			},
			'a new type leaving an attribute it does not have → XSI_TYPE_CHANGE_LEAVES_CONTENT naming it':
				{
					sourceXml: square,
					attributes: { 'xsi:type': 'tDD_1B' },
					refusedWith: 'XSI_TYPE_CHANGE_LEAVES_CONTENT',
					leftOver: { attributes: ['dDD_1'], children: [] },
				},
			'a new type leaving a child it does not hold → XSI_TYPE_CHANGE_LEAVES_CONTENT naming it': {
				sourceXml: squareWithCorner,
				attributes: { 'xsi:type': 'tDD_1B' },
				refusedWith: 'XSI_TYPE_CHANGE_LEAVES_CONTENT',
				leftOver: { attributes: [], children: ['DDD_1'] },
			},
			'a new type, the attribute it does not have cleared in the same update → accepted': {
				sourceXml: square,
				attributes: { 'xsi:type': 'tDD_1B', dDD_1: undefined },
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1B"]'],
				unexpectedQueries: ['//default:DD_1[@dDD_1]'],
			},
			'a new type fixing a value the update sets otherwise → FIXED_VALUE_VIOLATION, judged on the new type':
				{
					sourceXml: square,
					attributes: { 'xsi:type': 'tDD_1B', dDD_1: undefined, fDD_1: 'cm' },
					refusedWith: 'FIXED_VALUE_VIOLATION',
				},
			'another attribute of a stored value the element may not take → accepted, xsi:type untouched':
				{
					sourceXml: /* xml */ `<Root ${ns}><D aD="d"><DD_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="s" xsi:type="tDD_1C" aDD_1="s"/></D></Root>`,
					attributes: { aDD_1: 'renamed' },
					expectedQueries: ['//default:DD_1[@xsi:type="tDD_1C"][@aDD_1="renamed"]'],
				},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			const written = source.transaction(async (tx) => {
				await tx.update({ tagName: 'DD_1', id: 's' }, { attributes: testCase.attributes } as never)
			})
			if (testCase.refusedWith === undefined) {
				await written
				return {}
			}
			const cause = {
				key: testCase.refusedWith,
				...(testCase.leftOver ? { meta: testCase.leftOver } : {}),
			}
			await expect(written).rejects.toMatchObject({ cause })
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})

	describe('xsi:type in the object form of addChild', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'a variant named beside the declared attributes → stored like any value': {
				sourceXml: /* xml */ `<Root ${ns}><D ${CUSTOM_RECORD_ID_ATTRIBUTE}="d" aD="d"/></Root>`,
				expectedQueries: ['//default:DD_1[@xsi:type="tDD_1B"][@aDD_1="s"]'],
			},
		}

		async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
			await source.transaction(async (tx) => {
				// typed: the object form takes every attribute under its stored name, 'xsi:type' included
				await tx.addChild(
					{ tagName: 'D', id: 'd' },
					{ tagName: 'DD_1', attributes: { aDD_1: 's', 'xsi:type': 'tDD_1B' } },
				)
			})
			return {}
		}

		runTestCases.withExport<TestCase>({ testCases, act })
	})
})
