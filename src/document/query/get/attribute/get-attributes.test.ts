import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE, toRef } from '@/helpers'
import { XMLNS_XSI_NAMESPACE } from '@/helpers/constant'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	createTestProject,
	runTestCases,
} from '@/test'

import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const nsExt = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttributes', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'returns value object for all present attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: { aA: 'hello' },
		},
		'omits an absent required attribute that has no schema default': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: {},
		},
		'injects an absent fixed attribute as its fixed value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" />
					</C>
				</Root>
			`,
			ref: { tagName: 'CC_1', id: 'cc1' },
			expected: { aCC_1: 'fixed_val' },
		},
		'injects an absent non-empty default value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<B ${customId}="b1">
						<BB_1 ${customId}="bb1">
							<BBB_1 ${customId}="bbb1" />
						</BB_1>
					</B>
				</Root>
			`,
			ref: { tagName: 'BBB_1', id: 'bbb1' },
			expected: { bBBB_1: 'false' },
		},
		'returns empty object when ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,

			ref: { tagName: 'A', id: 'missing' },
			expected: {},
		},
		"the type it names with xsi:type -> beside its attributes, the variant's included": {
			sourceXml: /* xml */ `
				<Root ${ns} ${XMLNS_XSI_NAMESPACE}>
					<D>
						<DD_2 ${customId}="dd2" xsi:type="tDD_2A" aDD_2="x" dDD_2="y" />
					</D>
				</Root>
			`,
			ref: { tagName: 'DD_2', id: 'dd2' },
			expected: { aDD_2: 'x', dDD_2: 'y', 'xsi:type': 'tDD_2A' },
		},
		'returns multiple attributes when record has several': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<AA_1 ${customId}="aa1" aAA_1="v1" />
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expected: { aAA_1: 'v1' },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttributes(testCase.ref)
		expect(result).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttributes (namespace scoping)', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		namespace?: string
		expected: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'no namespace option → every attribute under the name it is stored by, a namespaced one prefixed':
			{
				sourceXml: /* xml */ `
					<Root ${nsExt}>
						<A ${customId}="a1" aA="hi" ext:cA="qualified" />
					</Root>
				`,
				ref: { tagName: 'A', id: 'a1' },
				expected: { aA: 'hi', 'ext:cA': 'qualified' },
			},
		'scoped by namespace key → returns only that namespace, keyed by local name': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" ext:cA="qualified" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			namespace: 'ext',
			expected: { cA: 'qualified' },
		},
		'scoped by namespace with no matching attribute → empty object': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			namespace: 'ext',
			expected: {},
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttributes(
			testCase.ref,
			(testCase.namespace ? { namespace: testCase.namespace } : undefined) as never,
		)
		expect(result).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttributesFullObject', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		defaults?: 'none' | 'optional' | 'required'
		expected: { name: string; value: string }[]
	}

	const testCases: Record<string, TestCase> = {
		'returns full attribute objects for all present attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [{ name: 'aA', value: 'world' }],
		},
		"defaults: 'none' keeps only stored attributes verbatim": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" />
					</C>
				</Root>
			`,
			ref: { tagName: 'CC_1', id: 'cc1' },
			defaults: 'none',
			expected: [],
		},
		"defaults: 'optional' (default) synthesizes an absent fixed attribute": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" />
					</C>
				</Root>
			`,
			ref: { tagName: 'CC_1', id: 'cc1' },
			expected: [{ name: 'aCC_1', value: 'fixed_val' }],
		},
		"defaults: 'optional' does not fabricate a required-without-default attribute": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			defaults: 'optional',
			expected: [],
		},
		"defaults: 'required' materializes an absent required attribute as ''": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<AA_1 ${customId}="aa1" />
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			defaults: 'required',
			expected: [{ name: 'aAA_1', value: '' }],
		},
		'returns empty array when ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			expected: [],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttributes(testCase.ref, {
			fullObject: true,
			...(testCase.defaults ? { defaults: testCase.defaults } : {}),
		})
		expect(result).toEqual(
			expect.arrayContaining(testCase.expected.map((e) => expect.objectContaining(e))),
		)
		expect(result).toHaveLength(testCase.expected.length)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttributes (record argument)', () => {
	const sourceXml = /* xml */ `
		<Root ${nsExt}>
			<A ${customId}="a1" aA="hello" ext:cA="qualified" />
			<C ${customId}="c1">
				<CC_1 ${customId}="cc1" />
			</C>
		</Root>
	`

	it('reads a record as given without a store round trip; a bare ref still fetches', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			const record = await doc.query.getRecord({ tagName: 'A', id: 'a1' })
			doc.perf.reset()

			expect(await doc.query.getAttributes(record)).toEqual({ aA: 'hello', 'ext:cA': 'qualified' })
			expect(await doc.query.getAttributes(record, { namespace: 'ext' })).toEqual({
				cA: 'qualified',
			})
			expect(await doc.query.getAttributes(record, { fullObject: true })).toEqual([
				expect.objectContaining({ name: 'aA', value: 'hello' }),
				expect.objectContaining({ name: 'ext:cA', value: 'qualified' }),
			])
			const report = doc.perf.report()
			expect(report['core::store::get']?.count ?? 0).toBe(0)
			expect(report['core::query::getRecord.fromRecord']?.count ?? 0).toBe(3)

			doc.perf.reset()
			expect(await doc.query.getAttributes({ tagName: 'A', id: 'a1' })).toEqual({
				aA: 'hello',
				'ext:cA': 'qualified',
			})
			expect(doc.perf.report()['core::store::get']?.count ?? 0).toBe(1)
		} finally {
			await project.destroy()
		}
	})

	it('fills the schema defaults of a getTree node without a store round trip', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			const tree = await doc.query.getTree({ tagName: 'C', id: 'c1' })
			const node = tree?.tree[0]
			doc.perf.reset()

			expect(await doc.query.getAttributes(node)).toEqual({ aCC_1: 'fixed_val' })
			expect(await doc.query.getAttributes(node, { fullObject: true })).toEqual([
				expect.objectContaining({ name: 'aCC_1', value: 'fixed_val' }),
			])
			expect(doc.perf.report()['core::store::get']?.count ?? 0).toBe(0)
		} finally {
			await project.destroy()
		}
	})

	it('inside a transaction, a record held from before a staged update reads the staged value', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			const held = await doc.query.getRecord({ tagName: 'A', id: 'a1' })

			await doc.transaction(async (tx) => {
				await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
				doc.perf.reset()

				expect(await tx.getAttributes(held)).toMatchObject({ aA: 'new' })
				expect(await tx.getAttributes(held, { fullObject: true })).toEqual(
					expect.arrayContaining([expect.objectContaining({ name: 'aA', value: 'new' })]),
				)
				expect(doc.perf.report()['core::store::get']?.count ?? 0).toBe(0)
			})
			// Committed: outside a transaction the held record is a snapshot; its ref reads the store again.
			expect(await doc.query.getAttributes(held)).toMatchObject({ aA: 'hello' })
			expect(await doc.query.getAttributes(toRef(held))).toMatchObject({ aA: 'new' })
		} finally {
			await project.destroy()
		}
	})

	it('inside a transaction, a record held from before a staged delete reads as absent', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const doc = source.document
			const held = await doc.query.getRecord({ tagName: 'A', id: 'a1' })

			await doc.transaction(async (tx) => {
				await tx.delete({ tagName: 'A', id: 'a1' })

				expect(await tx.getAttributes(held)).toEqual({})
				expect(await tx.getAttributes(held, { fullObject: true })).toEqual([])
			})
		} finally {
			await project.destroy()
		}
	})
})
