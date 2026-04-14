import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestDialecte,
	runTestCases,
} from '@/test'
import { invariant } from '@/utils'

import type { CloneMapping } from './clone.types'
import type { Transaction } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, AnyTreeRecord, Operation, Ref } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a test dialecte config with a beforeClone hook that appends a
 * `dev:clone-index` qualified attribute to every cloned element. The value is
 * `clone:${record.id}`, deterministic and stateless.
 * This lets tests assert both that the source still exists (via _temp-idb-id)
 * and that the clone also exists (via dev:clone-index).
 */
function makeCloneConfig(): typeof TEST_DIALECTE_CONFIG {
	return {
		...TEST_DIALECTE_CONFIG,
		hooks: {
			beforeClone: ({ record }: { record: AnyTreeRecord }) => ({
				shouldBeCloned: true,
				transformedRecord: {
					...record,
					attributes: [
						...(record.attributes as any[]),
						{
							name: 'clone-index',
							value: `clone:${record.id}`,
							namespace: DIALECTE_NAMESPACES.dev,
						},
					],
				} as typeof record,
			}),
		},
	} as typeof TEST_DIALECTE_CONFIG
}

function makeSkipConfig(skipTagName: string): typeof TEST_DIALECTE_CONFIG {
	return {
		...TEST_DIALECTE_CONFIG,
		hooks: {
			beforeClone: ({ record }: { record: AnyTreeRecord }) => ({
				shouldBeCloned: record.tagName !== skipTagName,
				transformedRecord: record,
			}),
		},
	} as typeof TEST_DIALECTE_CONFIG
}

/**
 * Composes makeCloneConfig + an afterDeepClone hook that stages an update
 * adding `dev:post-clone="mapped:<source.id>"` to every cloned target.
 * This proves the hook fires after all clones with correct mappings.
 */
function makeAfterDeepCloneConfig(): typeof TEST_DIALECTE_CONFIG {
	const base = makeCloneConfig()
	return {
		...base,
		hooks: {
			...base.hooks,
			afterDeepClone: async <GenericConfig extends AnyDialecteConfig>({
				mappings,
				query,
			}: {
				mappings: CloneMapping<GenericConfig>[]
				query: Transaction<GenericConfig>
			}): Promise<Operation<GenericConfig>[]> => {
				const operations: Operation<GenericConfig>[] = []
				for (const mapping of mappings) {
					// Find the latest operation for this target to get current state
					const allOps = query
						.getStagedOperations()
						.filter((op) => op.status !== 'deleted' && op.newRecord?.id === mapping.target.id)
					const latestOp = allOps[allOps.length - 1]
					if (!latestOp || latestOp.status === 'deleted') continue

					const currentRecord = latestOp.newRecord!
					const newRecord = {
						...currentRecord,
						attributes: [
							...currentRecord.attributes,
							{
								name: 'post-clone',
								value: `mapped:${String(mapping.source.id)}`,
								namespace: DIALECTE_NAMESPACES.dev,
							},
						],
					}
					operations.push({ status: 'updated', oldRecord: currentRecord, newRecord })
				}
				return operations
			},
		},
	} as typeof TEST_DIALECTE_CONFIG
}

describe('stageDeepClone', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		sourceRef: Ref<TestDialecteConfig, 'AA_1'>
		parentRef: Ref<TestDialecteConfig, 'A'>
	}

	const testCases: TestCases<TestCase> = {
		'leaf element → clone has same attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="leaf" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="leaf"]',
				'//default:AA_1[@dev:clone-index="clone:aa1"][@aAA_1="leaf"]',
			],
		},
		'cloned leaf → source element still exists unchanged': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="source" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="source"]',
				'//default:AA_1[@dev:clone-index="clone:aa1"][@aAA_1="source"]',
			],
		},
		'element with direct children → clone includes all children': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
						</AA_1>
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@_temp-idb-id="aaa1"]',
				'//default:AA_1[@dev:clone-index="clone:aa1"]/default:AAA_1[@dev:clone-index="clone:aaa1"]',
			],
		},
		'element with deep descendants → clone includes full subtree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="l2">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="l3" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@_temp-idb-id="aaa1"]',
				'//default:AAA_1[@_temp-idb-id="aaa1"]/default:AAAA_1[@_temp-idb-id="aaaa1"]',
				'//default:AA_1[@dev:clone-index="clone:aa1"]/default:AAA_1[@dev:clone-index="clone:aaa1"]',
				'//default:AAA_1[@dev:clone-index="clone:aaa1"]/default:AAAA_1[@dev:clone-index="clone:aaaa1"]',
			],
		},
		'sibling elements present → only target is cloned, siblings untouched': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="source" />
						<AA_2 ${customId}="aa2" aAA_2="sibling" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="source"]',
				'//default:AA_1[@dev:clone-index="clone:aa1"][@aAA_1="source"]',
				'//default:AA_2[@_temp-idb-id="aa2"][@aAA_2="sibling"]',
			],
			unexpectedQueries: ['//default:AA_2/default:AA_1'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const treeRecord = await source.document.query.getTree(testCase.sourceRef)
		await source.document.transaction(async (tx) => {
			invariant(treeRecord, {
				key: 'ELEMENT_NOT_FOUND',
				detail: 'getTree returned undefined for sourceRef',
				ref: testCase.sourceRef,
			})
			await tx.deepClone(testCase.parentRef, treeRecord)
		})
		return { assertDatabaseName: source.databaseName, withDatabaseIds: true }
	}

	runTestCases.withExport({ testCases, dialecteConfig: makeCloneConfig(), act })

	// ── beforeClone skip ─────────────────────────────────────────────────────

	const skipTestCases: TestCases<TestCase> = {
		'skipped element → clone omits child, source keeps it': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="skip-me" />
						</AA_1>
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: ['//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@aAAA_1="skip-me"]'],
			unexpectedQueries: ['//default:AA_1[not(@_temp-idb-id="aa1")]/default:AAA_1'],
		},
	}

	runTestCases.withExport({
		testCases: skipTestCases,
		dialecteConfig: makeSkipConfig('AAA_1'),
		act,
	})

	// ── Return value ─────────────────────────────────────────────────────────

	describe('return value', () => {
		type ReturnValueCase = {
			sourceXml: string
			sourceRef: Ref<TestDialecteConfig, 'AA_1'>
			parentRef: Ref<TestDialecteConfig, 'A'>
			expectedRecordTagName: string
			expectedMappingsCount: number
		}

		const returnValueCases: Record<string, ReturnValueCase> = {
			'leaf element → 1 mapping (self)': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="parent">
							<AA_1 ${customId}="aa1" aAA_1="leaf" />
						</A>
					</Root>
				`,
				sourceRef: { tagName: 'AA_1', id: 'aa1' },
				parentRef: { tagName: 'A', id: 'a1' },
				expectedRecordTagName: 'AA_1',
				expectedMappingsCount: 1,
			},
			'parent + child → 2 mappings': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="parent">
							<AA_1 ${customId}="aa1" aAA_1="l1">
								<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
							</AA_1>
						</A>
					</Root>
				`,
				sourceRef: { tagName: 'AA_1', id: 'aa1' },
				parentRef: { tagName: 'A', id: 'a1' },
				expectedRecordTagName: 'AA_1',
				expectedMappingsCount: 2,
			},
			'deep tree → 3 mappings': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="parent">
							<AA_1 ${customId}="aa1" aAA_1="l1">
								<AAA_1 ${customId}="aaa1" aAAA_1="l2">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="l3" />
								</AAA_1>
							</AA_1>
						</A>
					</Root>
				`,
				sourceRef: { tagName: 'AA_1', id: 'aa1' },
				parentRef: { tagName: 'A', id: 'a1' },
				expectedRecordTagName: 'AA_1',
				expectedMappingsCount: 3,
			},
		}

		it.each(Object.entries(returnValueCases))('%s', async (_, tc) => {
			const { document, cleanup } = await createTestDialecte({
				xmlString: tc.sourceXml,
				dialecteConfig: makeCloneConfig(),
			})

			try {
				const treeRecord = await document.query.getTree(tc.sourceRef)
				invariant(treeRecord, {
					key: 'ELEMENT_NOT_FOUND',
					detail: 'getTree returned undefined for sourceRef',
					ref: tc.sourceRef,
				})

				const result = await document.transaction(async (tx) => {
					return tx.deepClone(tc.parentRef, treeRecord as any)
				})

				expect(result.record.tagName).toBe(tc.expectedRecordTagName)
				expect(result.mappings).toHaveLength(tc.expectedMappingsCount)
			} finally {
				await cleanup()
			}
		})
	})

	// ── afterDeepClone hook ──────────────────────────────────────────────────

	const afterDeepCloneTestCases: TestCases<TestCase> = {
		'leaf clone → hook adds post-clone attr via mapping': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="leaf" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: ['//default:AA_1[@dev:post-clone="mapped:aa1"]'],
		},
		'deep tree → hook adds post-clone to every cloned descendant': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
						</AA_1>
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: [
				'//default:AA_1[@dev:post-clone="mapped:aa1"]',
				'//default:AAA_1[@dev:post-clone="mapped:aaa1"]',
			],
		},
		'source elements → no post-clone attr on originals': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="source" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedQueries: ['//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="source"]'],
			unexpectedQueries: ['//default:AA_1[@_temp-idb-id="aa1"][@dev:post-clone]'],
		},
	}

	runTestCases.withExport({
		testCases: afterDeepCloneTestCases,
		dialecteConfig: makeAfterDeepCloneConfig(),
		act,
	})
})
