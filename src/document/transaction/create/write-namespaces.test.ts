import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, XMLNS_XSI_NAMESPACE, XSI_NAMESPACE } from '@/helpers/constant'
import {
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { isXsiTypeAttribute } from '@/utils/xsi-type'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}`

/** An xsi:type attribute in the array form of a write. */
function xsiType(value: string) {
	return { name: 'type', value, namespace: XSI_NAMESPACE }
}

type AddChildCase = BaseXmlTestCase & { attributes: { name: string; value: string }[] }
type UpdateCase = BaseXmlTestCase & { attributes: Record<string, string> }
/** A refusal of a namespace declaration: the attribute its detail must name. */
type DeclarationCase = { declaration: string }

/** The document every create case starts from: a D with no child. */
const createSource = /* xml */ `
	<Root ${ns}>
		<D ${customId}="d" aD="d"/>
	</Root>
`
/** The document every update case starts from: a DD_2 under a D, its declared type, no xsi:type. */
const updateSource = /* xml */ `
	<Root ${ns}>
		<D aD="d">
			<DD_2 ${customId}="s" aDD_2="p"/>
		</D>
	</Root>
`

/** The built-in xsi:type rows start from a DD_2 under a D: DDD_2, its child, is of no declared type (anyType). */
const createDddSource = /* xml */ `
	<Root ${ns}>
		<D ${customId}="d" aD="d">
			<DD_2 ${customId}="dd" aDD_2="p"/>
		</D>
	</Root>
`
/** The document the built-in update rows start from: a DDD_2 under a DD_2 under a D, no xsi:type. */
const updateDddSource = /* xml */ `
	<Root ${ns}>
		<D aD="d">
			<DD_2 aDD_2="p">
				<DDD_2 ${customId}="s"/>
			</DD_2>
		</D>
	</Root>
`

type Tx = Parameters<
	Parameters<ActParams<TestDialecteConfig, BaseXmlTestCase>['source']['transaction']>[0]
>[0]
type Refusal = { key?: string; detail?: string; staged: ReadonlyArray<unknown> }

/**
 * Run a write that is refused, inside a transaction: catch it there and read what it left (its key, its detail, the
 * staged operations); the test asserts it after the transaction, so a failed assertion stays an assertion.
 */
async function captureRefusal(params: {
	source: ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
	write: (tx: Tx) => Promise<unknown>
}): Promise<Refusal> {
	let refusal: Refusal = { staged: [] }
	await params.source.transaction(async (tx) => {
		const thrown = await params.write(tx).catch((error: unknown) => error)
		const dialecteError = toDialecteError(thrown)
		refusal = {
			key: dialecteError?.key,
			detail: dialecteError?.detail,
			staged: tx.getStagedOperations(),
		}
	})
	return refusal
}

/** The xsi:type values the document's records of a tag store, in store order. */
async function storedXsiTypes(params: {
	source: ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
	tagName: 'DD_1' | 'DD_2' | 'DDD_2'
}): Promise<(string | undefined)[]> {
	const records = await params.source.query.getRecordsByTagName(params.tagName)
	return records.map((record) => {
		const value = record.attributes.find(isXsiTypeAttribute)?.value
		return typeof value === 'string' ? value : undefined
	})
}

type StoredCase = BaseXmlTestCase & { expectedStored: (string | undefined)[] }

describe('write - an XSD built-in xsi:type', () => {
	type CreateCase = StoredCase & { attributes: { name: string; value: string }[] }
	const createCases: TestCases<CreateCase> = {
		'xs:integer on a create, xs declared on no record → admitted, stored xs:integer': {
			sourceXml: createDddSource,
			attributes: [xsiType('xs:integer')],
			expectedStored: ['xs:integer'],
		},
		'the XSD Clark name of integer on a create → admitted, stored xs:integer': {
			sourceXml: createDddSource,
			attributes: [xsiType('{http://www.w3.org/2001/XMLSchema}integer')],
			expectedStored: ['xs:integer'],
		},
	}
	runTestCases.withoutExport<CreateCase>({
		testCases: createCases,
		act: async ({ source, testCase }) => {
			await source.transaction(async (tx) => {
				// the attributes are plain strings built per case: the typed overloads cannot take them
				await tx.addChild({ tagName: 'DD_2', id: 'dd' }, {
					tagName: 'DDD_2',
					attributes: testCase.attributes,
				} as never)
			})
			const stored = await storedXsiTypes({ source, tagName: 'DDD_2' })
			expect(stored).toEqual(testCase.expectedStored)
		},
	})

	type UpdatedCase = StoredCase & { attributes: Record<string, string> }
	const updateCases: TestCases<UpdatedCase> = {
		'xs:integer on an update, xs declared on an ancestor only → admitted, stored xs:integer': {
			sourceXml: /* xml */ `
				<Root ${ns} xmlns:xs="http://www.w3.org/2001/XMLSchema">
					<D aD="d">
						<DD_2 aDD_2="p">
							<DDD_2 ${customId}="s"/>
						</DD_2>
					</D>
				</Root>
			`,
			attributes: { 'xsi:type': 'xs:integer' },
			expectedStored: ['xs:integer'],
		},
		'the XSD Clark name of integer on an update → admitted, stored xs:integer': {
			sourceXml: updateDddSource,
			attributes: { 'xsi:type': '{http://www.w3.org/2001/XMLSchema}integer' },
			expectedStored: ['xs:integer'],
		},
	}
	runTestCases.withoutExport<UpdatedCase>({
		testCases: updateCases,
		act: async ({ source, testCase }) => {
			await source.transaction(async (tx) => {
				await tx.update({ tagName: 'DDD_2', id: 's' }, { attributes: testCase.attributes } as never)
			})
			const stored = await storedXsiTypes({ source, tagName: 'DDD_2' })
			expect(stored).toEqual(testCase.expectedStored)
		},
	})
})

describe('write - an xsi:type with a dialecte prefix', () => {
	type CreateCase = StoredCase & { attributes: { name: string; value: string }[] }
	const createCases: TestCases<CreateCase> = {
		'ext:tDD_1A on a create of DD_1 → stored ext:tDD_1A as written': {
			sourceXml: createSource,
			attributes: [
				{ name: 'aDD_1', value: 's' },
				{ name: 'dDD_1', value: '1' },
				xsiType('ext:tDD_1A'),
			],
			expectedStored: ['ext:tDD_1A'],
		},
	}
	runTestCases.withoutExport<CreateCase>({
		testCases: createCases,
		act: async ({ source, testCase }) => {
			await source.transaction(async (tx) => {
				await tx.addChild({ tagName: 'D', id: 'd' }, {
					tagName: 'DD_1',
					attributes: testCase.attributes,
				} as never)
			})
			const stored = await storedXsiTypes({ source, tagName: 'DD_1' })
			expect(stored).toEqual(testCase.expectedStored)
		},
	})
})

describe('write - an xsi:type prefix outside the engine table', () => {
	const addChildCases: TestCases<AddChildCase> = {
		'q:tDD_2 on a create, q bound by no engine table → UNKNOWN_NAMESPACE_PREFIX naming q, nothing staged':
			{
				sourceXml: createSource,
				attributes: [{ name: 'aDD_2', value: 'p' }, xsiType('q:tDD_2')],
				expectedQueries: ['//default:D[@aD="d"]'],
				unexpectedQueries: ['//default:DD_2'],
			},
	}
	runTestCases.withExport<AddChildCase>({
		testCases: addChildCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					tx.addChild({ tagName: 'D', id: 'd' }, {
						tagName: 'DD_2',
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe('UNKNOWN_NAMESPACE_PREFIX')
			expect(refusal.detail).toMatch(/\bq\b/)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})

	const updateCases: TestCases<UpdateCase> = {
		'q:tDD_2 on an update, q declared on an ancestor → UNKNOWN_NAMESPACE_PREFIX naming q, nothing staged':
			{
				sourceXml: /* xml */ `
					<Root ${ns} xmlns:q="urn:q">
						<D aD="d">
							<DD_2 ${customId}="s" aDD_2="p"/>
						</D>
					</Root>
				`,
				attributes: { 'xsi:type': 'q:tDD_2' },
				expectedQueries: ['//default:D/default:DD_2[@aDD_2="p"]'],
				unexpectedQueries: ['//default:DD_2[@xsi:type]'],
			},
	}
	runTestCases.withExport<UpdateCase>({
		testCases: updateCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					tx.update({ tagName: 'DD_2', id: 's' }, {
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe('UNKNOWN_NAMESPACE_PREFIX')
			expect(refusal.detail).toMatch(/\bq\b/)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})
})

describe('write - a namespace declaration given as an attribute', () => {
	const addChildCases: TestCases<AddChildCase & DeclarationCase> = {
		'xmlns:g in the array form on a create → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged': {
			declaration: 'xmlns:g',
			sourceXml: createSource,
			attributes: [
				{ name: 'aDD_2', value: 'p' },
				{ name: 'xmlns:g', value: 'urn:g' },
			],
			expectedQueries: ['//default:D[@aD="d"]'],
			unexpectedQueries: ['//default:DD_2'],
		},
		'xmlns in the array form on a create → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged': {
			declaration: 'xmlns',
			sourceXml: createSource,
			attributes: [
				{ name: 'aDD_2', value: 'p' },
				{ name: 'xmlns', value: 'urn:g' },
			],
			expectedQueries: ['//default:D[@aD="d"]'],
			unexpectedQueries: ['//default:DD_2'],
		},
	}
	runTestCases.withExport<AddChildCase & DeclarationCase>({
		testCases: addChildCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					tx.addChild({ tagName: 'D', id: 'd' }, {
						tagName: 'DD_2',
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe('NAMESPACE_DECLARATION_NOT_ALLOWED')
			expect(refusal.detail).toContain(testCase.declaration)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})

	type ObjectCase = BaseXmlTestCase & DeclarationCase & { attributes: Record<string, string> }
	const valueObjectCases: TestCases<ObjectCase> = {
		'xmlns:g in the value-object form on a create → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged':
			{
				declaration: 'xmlns:g',
				sourceXml: createSource,
				attributes: { aDD_2: 'p', 'xmlns:g': 'urn:g' },
				expectedQueries: ['//default:D[@aD="d"]'],
				unexpectedQueries: ['//default:DD_2'],
			},
		'xmlns in the value-object form on a create → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged':
			{
				declaration: 'xmlns',
				sourceXml: createSource,
				attributes: { aDD_2: 'p', xmlns: 'urn:g' },
				expectedQueries: ['//default:D[@aD="d"]'],
				unexpectedQueries: ['//default:DD_2'],
			},
	}
	runTestCases.withExport<ObjectCase>({
		testCases: valueObjectCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					tx.addChild({ tagName: 'D', id: 'd' }, {
						tagName: 'DD_2',
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe('NAMESPACE_DECLARATION_NOT_ALLOWED')
			expect(refusal.detail).toContain(testCase.declaration)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})

	const updateCases: TestCases<UpdateCase & DeclarationCase> = {
		'xmlns:g on an update → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged': {
			declaration: 'xmlns:g',
			sourceXml: updateSource,
			attributes: { 'xmlns:g': 'urn:g' },
			expectedQueries: ['//default:D/default:DD_2[@aDD_2="p"]'],
		},
		'xmlns on an update → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged': {
			declaration: 'xmlns',
			sourceXml: updateSource,
			attributes: { xmlns: 'urn:g' },
			expectedQueries: ['//default:D/default:DD_2[@aDD_2="p"]'],
		},
	}
	runTestCases.withExport<UpdateCase & DeclarationCase>({
		testCases: updateCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					tx.update({ tagName: 'DD_2', id: 's' }, {
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe('NAMESPACE_DECLARATION_NOT_ALLOWED')
			expect(refusal.detail).toContain(testCase.declaration)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})
})

describe('write - a foreign Clark xsi:type on an element the definition does not declare', () => {
	type CreateCase = BaseXmlTestCase & { attributes: { name: string; value: string }[] }
	const createCases: TestCases<CreateCase> = {
		'{urn:f}Kind on a create of an undeclared tag → admitted, stored {urn:f}Kind as written': {
			sourceXml: createSource,
			attributes: [{ name: 'aDD_2', value: 'p' }, xsiType('{urn:f}Kind')],
		},
	}
	runTestCases.withoutExport<CreateCase>({
		testCases: createCases,
		act: async ({ source, testCase }) => {
			await source.transaction(async (tx) => {
				// a tag outside the typed definition and plain-string attributes: no typed overload takes them
				await tx.addChild({ tagName: 'D', id: 'd' }, {
					tagName: 'Undeclared',
					attributes: testCase.attributes,
				} as never)
			})
			const records = await source.query.getRecordsByTagName('Undeclared' as never)
			const stored = records.map((record) => record.attributes.find(isXsiTypeAttribute)?.value)
			expect(stored).toEqual(['{urn:f}Kind'])
		},
	})
})
