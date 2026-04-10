import { describe, expect, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	runTestCases,
} from '@/test'

import type { UpdateParams } from './update.types'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref } from '@/types'

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
		'attribute set to null → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: null as any, bA: 'keep' } },
			expectedQueries: ['//default:A[@bA="keep"]'],
			unexpectedQueries: ['//default:A[@aA]'],
		},
		'attribute set to undefined → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: undefined, bA: 'keep' } },
			expectedQueries: ['//default:A[@bA="keep"]'],
			unexpectedQueries: ['//default:A[@aA]'],
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
					<A ${customId}="element-a" aA="keep" bA="change" cA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'changed' } },
			expectedQueries: ['//default:A[@aA="keep"][@bA="changed"][@cA="keep"]'],
			unexpectedQueries: ['//default:A[@bA="change"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.update(testCase.targetRef, testCase.updateParams)
		})
		return { assertDatabaseName: source.databaseName }
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageUpdate hooks — spy behavior', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const afterUpdated = vi.fn().mockResolvedValue([])
	const config = { ...TEST_DIALECTE_CONFIG, hooks: { afterUpdated } }

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
		const transaction = source.document.transaction(async (tx) => {
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

	runTestCases.withoutExport({ testCases, act, dialecteConfig: config as any })
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

	const config = {
		...TEST_DIALECTE_CONFIG,
		hooks: {
			afterUpdated: vi.fn().mockImplementation(async ({ newRecord, context }: any) => {
				if (newRecord.tagName !== 'A') return []
				const [bRecord] = await context.store.getByTagName('B')
				if (!bRecord) return []
				const updatedB = {
					...bRecord,
					attributes: bRecord.attributes.map((a: any) =>
						a.name === 'aB' ? { ...a, value: 'cascade' } : a,
					),
				}
				return [{ status: 'updated' as const, oldRecord: bRecord, newRecord: updatedB }]
			}),
		},
	}

	async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
		})
		return { assertDatabaseName: source.databaseName }
	}

	runTestCases.withExport({ testCases, act, dialecteConfig: config as any })
})
