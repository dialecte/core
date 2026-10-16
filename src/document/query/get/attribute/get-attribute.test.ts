import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	createTestProject,
	runTestCases,
} from '@/test'

import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AttributesOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const nsExt = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttribute', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'returns attribute value when it exists': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: 'hello',
		},
		"returns '' when attribute does not exist on the record": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
		"returns '' when the ref does not exist": {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: '',
		},
		'returns empty string for an empty attribute value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttribute(testCase.ref, {
			name: testCase.attributeName as 'aA',
		})
		expect(result).toBe(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttributeFullObject', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: { name: string; value: string } | undefined
	}

	const testCases: Record<string, TestCase> = {
		'returns the full attribute object when it exists': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: { name: 'aA', value: 'world' },
		},
		'returns undefined when attribute does not exist on the record': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="present" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'bA',
			expected: undefined,
		},
		'returns undefined when the ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: undefined,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttribute(testCase.ref, {
			name: testCase.attributeName as 'aA',
			fullObject: true,
		})
		if (testCase.expected === undefined) {
			expect(result).toBeUndefined()
		} else {
			expect(result).toMatchObject(testCase.expected)
		}
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttribute (namespace scoping)', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, 'A'>
		name: string
		namespace?: string
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'scoped by namespace key → resolves the prefixed attribute': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" ext:cA="qualified" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			name: 'cA',
			namespace: 'ext',
			expected: 'qualified',
		},
		'no namespace option + local name → reads the default-namespace attribute': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" ext:cA="qualified" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			name: 'aA',
			expected: 'hi',
		},
		'scoped by namespace + local name absent → empty string': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			name: 'cA',
			namespace: 'ext',
			expected: '',
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttribute(testCase.ref, {
			name: testCase.name,
			namespace: testCase.namespace,
		})
		expect(result).toBe(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttribute (record argument)', () => {
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
			const tree = await doc.query.getTree({ tagName: 'C', id: 'c1' })
			const node = tree?.tree[0]
			doc.perf.reset()

			expect(await doc.query.getAttribute(record, { name: 'aA' })).toBe('hello')
			expect(await doc.query.getAttribute(record, { name: 'cA', namespace: 'ext' })).toBe(
				'qualified',
			)
			expect(await doc.query.getAttribute(record, { name: 'aA', fullObject: true })).toMatchObject({
				name: 'aA',
				value: 'hello',
			})
			expect(await doc.query.getAttribute(node, { name: 'aCC_1' })).toBe('fixed_val')
			expect(await doc.query.getAttribute(node, { name: 'aCC_1', fullObject: true })).toMatchObject(
				{
					name: 'aCC_1',
					value: 'fixed_val',
				},
			)
			const report = doc.perf.report()
			expect(report['core::store::get']?.count ?? 0).toBe(0)
			expect(report['core::query::getRecord.fromRecord']?.count ?? 0).toBe(5)

			doc.perf.reset()
			expect(await doc.query.getAttribute({ tagName: 'A', id: 'a1' }, { name: 'aA' })).toBe('hello')
			expect(doc.perf.report()['core::store::get']?.count ?? 0).toBe(1)
		} finally {
			await project.destroy()
		}
	})

	it('inside a transaction, a record held from before a staged write reads as the transaction sees it', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			const held = await doc.query.getRecord({ tagName: 'A', id: 'a1' })

			await doc.transaction(async (tx) => {
				await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
				doc.perf.reset()

				expect(await tx.getAttribute(held, { name: 'aA' })).toBe('new')
				expect(await tx.getAttribute(held, { name: 'aA', fullObject: true })).toMatchObject({
					value: 'new',
				})
				expect(doc.perf.report()['core::store::get']?.count ?? 0).toBe(0)

				await tx.delete({ tagName: 'A', id: 'a1' })
				expect(await tx.getAttribute(held, { name: 'aA' })).toBe('')
				expect(await tx.getAttribute(held, { name: 'aA', fullObject: true })).toBeUndefined()
			})
		} finally {
			await project.destroy()
		}
	})
})
