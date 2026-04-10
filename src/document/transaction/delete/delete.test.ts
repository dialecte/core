import { describe, expect, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	runXmlTestCases,
} from '@/test'

import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref, ElementsOf } from '@/types'

describe('stageDelete', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		deleteRef?: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectThrow?: boolean
	}

	const testCases: TestCases<TestCase> = {
		'delete leaf → element removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedQueries: ['//default:A[@aA="target"]'],
		},
		'delete one sibling → other sibling remains': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<A ${customId}="a2" aA="sibling" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedQueries: ['//default:A[@aA="sibling"]'],
			unexpectedQueries: ['//default:A[@aA="target"]'],
		},
		'delete parent with children → parent and children removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="child" />
					</A>
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedQueries: ['//default:A[@aA="parent"]', '//default:AA_1[@aAA_1="child"]'],
		},
		'delete element with deep descendants → full subtree removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="level0">
						<AA_1 ${customId}="aa1" aAA_1="level1">
							<AAA_1 ${customId}="aaa1" aAAA_1="level2" />
						</AA_1>
					</A>
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedQueries: [
				'//default:A[@aA="level0"]',
				'//default:AA_1[@aAA_1="level1"]',
				'//default:AAA_1[@aAAA_1="level2"]',
			],
		},
		'delete one subtree → sibling subtree untouched': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="delete-me">
						<AA_1 ${customId}="aa1" aAA_1="child-of-deleted" />
					</A>
					<B ${customId}="b1" aB="keep-me" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedQueries: ['//default:B[@aB="keep-me"]'],
			unexpectedQueries: [
				'//default:A[@aA="delete-me"]',
				'//default:AA_1[@aAA_1="child-of-deleted"]',
			],
		},
		'throws when attempting to delete the root element': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			expectThrow: true,
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		if (testCase.expectThrow) {
			const transaction = source.document.transaction(async (tx) => {
				const [root] = await source.document.query.getRecordsByTagName('Root')
				await tx.delete({ tagName: 'Root', id: root.id } as any)
			})
			await expect(transaction).rejects.toThrow()
		} else {
			await source.document.transaction(async (tx) => {
				await tx.delete(testCase.deleteRef as any)
			})
		}
		return { assertDatabaseName: source.databaseName }
	}

	runXmlTestCases({ testCases, act })
})

describe('stageDelete hooks — spy behavior', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const beforeDelete = vi.fn().mockImplementation(async () => [])
	const config = { ...TEST_DIALECTE_CONFIG, hooks: { beforeDelete } }

	type TestCase = BaseXmlTestCase & {
		deleteRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectedTagName: string
		expectedChildCount: number
	}

	const testCases: TestCases<TestCase> = {
		'beforeDelete → called with the record being deleted': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedTagName: 'A',
			expectedChildCount: 0,
		},
		'beforeDelete → receives subtree root with children still attached': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="child" />
					</A>
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedTagName: 'A',
			expectedChildCount: 1,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		beforeDelete.mockClear()
		await source.document.transaction(async (tx) => {
			await tx.delete(testCase.deleteRef as any)
		})
		expect(beforeDelete).toHaveBeenCalledOnce()
		const [[callArgs]] = beforeDelete.mock.calls
		expect(callArgs.record.tagName).toBe(testCase.expectedTagName)
		expect(callArgs.record.children).toHaveLength(testCase.expectedChildCount)
	}

	runXmlTestCases({ testCases, act, dialecteConfig: config as any })
})

describe('stageDelete hooks — returned operations applied', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase
	const testCases: TestCases<TestCase> = {
		'beforeDelete returns update op on sibling → sibling updated in export': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<B ${customId}="b1" aB="before" />
				</Root>
			`,
			unexpectedQueries: ['//default:A[@aA="target"]'],
			expectedQueries: ['//default:B[@aB="after"]'],
		},
	}

	const config = {
		...TEST_DIALECTE_CONFIG,
		hooks: {
			beforeDelete: vi.fn().mockImplementation(async ({ record, context }: any) => {
				if (record.tagName !== 'A') return []
				const [bRecord] = await context.store.getByTagName('B')
				if (!bRecord) return []
				const updatedB = {
					...bRecord,
					attributes: bRecord.attributes.map((a: any) =>
						a.name === 'aB' ? { ...a, value: 'after' } : a,
					),
				}
				return [{ status: 'updated' as const, oldRecord: bRecord, newRecord: updatedB }]
			}),
		},
	}

	async function act({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.delete({ tagName: 'A', id: 'a1' })
		})
		return { assertDatabaseName: source.databaseName }
	}

	runXmlTestCases({ testCases, act, dialecteConfig: config as any })
})
