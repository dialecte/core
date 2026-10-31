import { describe, expect, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { UpdateParams } from './update.types'
import type { Transaction } from '@/document'
import type { Ref } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { RawRecord, ElementsOf } from '@/types'

describe('stageUpdate', () => {
	type TestCase = BaseXmlTestCase & {
		targetRef: Ref<TestDialecteConfig, 'A'> | Ref<TestDialecteConfig, 'B'>
		updateParams: UpdateParams<TestDialecteConfig, 'A'> | UpdateParams<TestDialecteConfig, 'B'>
	}

	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const testCases: TestCases<TestCase> = {
		'attribute updated → new value present, old value absent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' } },
			expectedQueries: ['//default:A[@aA="new"]'],
			unexpectedQueries: ['//default:A[@aA="old"]'],
		},
		'multiple attributes updated → all new values present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="x" bA="y" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'a', bA: 'b' } },
			expectedQueries: ['//default:A[@aA="a"][@bA="b"]'],
			unexpectedQueries: ['//default:A[@aA="x"]', '//default:A[@bA="y"]'],
		},
		'optional attribute set to null → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="keep" bA="remove" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: null as any } },
			expectedQueries: ['//default:A[@aA="keep"]'],
			unexpectedQueries: ['//default:A[@bA]'],
		},
		'optional attribute set to undefined → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="keep" bA="remove" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: undefined } },
			expectedQueries: ['//default:A[@aA="keep"]'],
			unexpectedQueries: ['//default:A[@bA]'],
		},
		'text content updated → new value present, old value absent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="attr">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { value: 'new-value' },
			expectedQueries: ['//default:A[@aA="attr"][text()="new-value"]'],
			unexpectedQueries: ['//default:A[text()="old-value"]'],
		},
		'attribute and value updated → all new values present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' }, value: 'new-value' },
			expectedQueries: ['//default:A[@aA="new"][text()="new-value"]'],
			unexpectedQueries: ['//default:A[@aA="old"]', '//default:A[text()="old-value"]'],
		},
		'new attribute added → all attributes present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="existing" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'new-attr' } },
			expectedQueries: ['//default:A[@aA="existing"][@bA="new-attr"]'],
		},
		'update one attribute → unchanged attributes unaffected': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="keep" bA="change" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'changed' } },
			expectedQueries: ['//default:A[@aA="keep"][@bA="changed"]'],
			unexpectedQueries: ['//default:A[@bA="change"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.transaction(async (tx) => {
			await tx.update(testCase.targetRef, testCase.updateParams)
		})
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageUpdate — an empty attribute value', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		targetRef: Ref<TestDialecteConfig, 'BBB_1'> | Ref<TestDialecteConfig, 'AA_1'>
		updateParams:
			| UpdateParams<TestDialecteConfig, 'BBB_1'>
			| UpdateParams<TestDialecteConfig, 'AA_1'>
		name: string
		/** the attribute as stored after the update (`defaults: 'none'`), undefined when not stored */
		expectedStored: { value: string } | undefined
		/** `getAttribute` with its default view, after the update */
		expectedRead: string
	}

	const bbb1 = /* xml */ `
		<Root ${ns}>
			<B aB="b">
				<BB_1 aBB_1="bb">
					<BBB_1 ${customId}="bbb1" aBBB_1="x" bBBB_1="true" />
				</BB_1>
			</B>
		</Root>
	`

	const testCases: TestCases<TestCase> = {
		'empty on an attribute with a default → stored empty, read empty (not the default)': {
			sourceXml: bbb1,
			targetRef: { tagName: 'BBB_1', id: 'bbb1' },
			updateParams: { attributes: { bBBB_1: '' } },
			name: 'bBBB_1',
			expectedStored: { value: '' },
			expectedRead: '',
			expectedQueries: ['//default:BBB_1[@aBBB_1="x"][@bBBB_1=""]'],
		},
		'undefined on an attribute with a default → removed, the default read again': {
			sourceXml: bbb1,
			targetRef: { tagName: 'BBB_1', id: 'bbb1' },
			updateParams: { attributes: { bBBB_1: undefined } },
			name: 'bBBB_1',
			expectedStored: undefined,
			expectedRead: 'false',
			expectedQueries: ['//default:BBB_1[@aBBB_1="x"]'],
			unexpectedQueries: ['//default:BBB_1[@bBBB_1]'],
		},
		'empty on an attribute with no default → removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="a">
						<AA_1 ${customId}="aa1" aAA_1="x" bAA_1="old" />
					</A>
				</Root>
			`,
			targetRef: { tagName: 'AA_1', id: 'aa1' },
			updateParams: { attributes: { bAA_1: '' } },
			name: 'bAA_1',
			expectedStored: undefined,
			expectedRead: '',
			expectedQueries: ['//default:AA_1[@aAA_1="x"]'],
			unexpectedQueries: ['//default:AA_1[@bAA_1]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const { targetRef, name } = testCase
		await source.transaction(async (tx) => {
			await tx.update(targetRef, testCase.updateParams)
		})
		const stored = await source.query.getAttribute(targetRef, {
			name: name as 'bBBB_1',
			defaults: 'none',
			fullObject: true,
		})
		if (testCase.expectedStored === undefined) expect(stored).toBeUndefined()
		else expect(stored).toMatchObject(testCase.expectedStored)
		const read = await source.query.getAttribute(targetRef, { name: name as 'bBBB_1' })
		expect(read).toBe(testCase.expectedRead)
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageUpdate — an empty value on a fixed attribute', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		targetRef: Ref<TestDialecteConfig, 'CC_1'>
		updateParams: UpdateParams<TestDialecteConfig, 'CC_1'>
	}

	const testCases: TestCases<TestCase> = {
		'empty on an attribute fixed to a non-empty value → FIXED_VALUE_VIOLATION, the value kept': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" aCC_1="fixed_val" />
					</C>
				</Root>
			`,
			targetRef: { tagName: 'CC_1', id: 'cc1' },
			// what untyped code could pass: the types only admit the fixed value
			updateParams: { attributes: { aCC_1: '' } as unknown as { aCC_1: 'fixed_val' } },
			expectedQueries: ['//default:CC_1[@aCC_1="fixed_val"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const written = source.transaction(async (tx) => {
			await tx.update(testCase.targetRef, testCase.updateParams)
		})
		await expect(written).rejects.toMatchObject({ cause: { key: 'FIXED_VALUE_VIOLATION' } })
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageUpdate — fixed attribute guard', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		targetRef: Ref<TestDialecteConfig, 'CC_1'>
		updateParams: UpdateParams<TestDialecteConfig, 'CC_1'>
		expectThrow: boolean
	}

	const testCases: TestCases<TestCase> = {
		'update a fixed attribute to a wrong value → throws': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" aCC_1="fixed_val" />
					</C>
				</Root>
			`,
			targetRef: { tagName: 'CC_1', id: 'cc1' },
			// @ts-expect-error the fixed attribute type only permits 'fixed_val'; this
			// exercises the RUNTIME guard for untyped/JS callers passing a wrong value.
			updateParams: { attributes: { aCC_1: 'wrong' } },
			expectThrow: true,
		},
		'update a fixed attribute to its fixed value → allowed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1">
						<CC_1 ${customId}="cc1" aCC_1="fixed_val" />
					</C>
				</Root>
			`,
			targetRef: { tagName: 'CC_1', id: 'cc1' },
			updateParams: { attributes: { aCC_1: 'fixed_val' } },
			expectThrow: false,
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const transaction = source.transaction(async (tx) => {
			await tx.update(testCase.targetRef, testCase.updateParams)
		})
		if (testCase.expectThrow) await expect(transaction).rejects.toThrow()
		else await transaction
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageUpdate hooks — spy behavior', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const afterUpdated = vi.fn().mockResolvedValue([])
	const hooks = { afterUpdated }

	type TestCase = BaseXmlTestCase & {
		updateRef: Ref<TestDialecteConfig, 'A'>
		expectedOldValue: string
		expectedNewValue: string
		expectThrow: boolean
	}

	const testCases: TestCases<TestCase> = {
		'afterUpdated → called with old and new record': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="old" />
				</Root>
			`,
			updateRef: { tagName: 'A', id: 'a1' },
			expectedOldValue: 'old',
			expectedNewValue: 'new',
			expectThrow: false,
		},
		'afterUpdated → not called when record does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			updateRef: { tagName: 'A', id: 'non-existent' },
			expectedOldValue: '',
			expectedNewValue: 'x',
			expectThrow: true,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		afterUpdated.mockClear()
		const transaction = source.transaction(async (tx) => {
			await tx.update(testCase.updateRef, { attributes: { aA: testCase.expectedNewValue } })
		})

		if (testCase.expectThrow) {
			await expect(transaction).rejects.toThrow()
			expect(afterUpdated).not.toHaveBeenCalled()
		} else {
			await transaction
			expect(afterUpdated).toHaveBeenCalledOnce()
			const [[callArgs]] = afterUpdated.mock.calls
			expect(callArgs.oldRecord.attributes.find((a: any) => a.name === 'aA')?.value).toBe(
				testCase.expectedOldValue,
			)
			expect(callArgs.newRecord.attributes.find((a: any) => a.name === 'aA')?.value).toBe(
				testCase.expectedNewValue,
			)
		}
	}

	runTestCases.withoutExport({ testCases, act, hooks })
})

describe('stageUpdate no-op guard', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const afterUpdated = vi.fn().mockResolvedValue([])
	const hooks = { afterUpdated }

	type TestCase = BaseXmlTestCase
	const testCases: TestCases<TestCase> = {
		're-applying the same attribute value → no update staged': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="same" />
				</Root>
			`,
		},
	}

	async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		afterUpdated.mockClear()
		await source.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'same' } })
		})
		// The canonical record is unchanged, so no 'updated' operation is staged and
		// the afterUpdated side-effect hook must not fire.
		expect(afterUpdated).not.toHaveBeenCalled()
	}

	runTestCases.withoutExport({ testCases, act, hooks })
})

describe('stageUpdate hooks — returned operations applied', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase
	const testCases: TestCases<TestCase> = {
		'afterUpdated returns update op on sibling → sibling also updated in export': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="old" />
					<B ${customId}="b1" aB="unchanged" />
				</Root>
			`,
			expectedQueries: ['//default:A[@aA="new"]', '//default:B[@aB="cascade"]'],
			unexpectedQueries: ['//default:B[@aB="unchanged"]'],
		},
	}

	const hooks = {
		afterUpdated: vi
			.fn()
			.mockImplementation(
				async ({
					newRecord,
					query,
				}: {
					newRecord: RawRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
					query: Transaction<TestDialecteConfig>
				}) => {
					if (newRecord.tagName !== 'A') return []
					const [bRecord] = await query.getRecordsByTagName('B')
					if (!bRecord) return []
					const updatedB = {
						...bRecord,
						attributes: bRecord.attributes.map((a: any) =>
							a.name === 'aB' ? { ...a, value: 'cascade' } : a,
						),
					}
					return [{ status: 'updated' as const, oldRecord: bRecord, newRecord: updatedB }]
				},
			),
	}

	async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
		})
		return {}
	}

	runTestCases.withExport({ testCases, act, hooks })
})
