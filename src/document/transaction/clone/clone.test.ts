import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createXmlAssertions,
	createTestDialecte,
	runTestCases,
} from '@/test'
import { assert } from '@/utils'

import type { ActParams, ActResult, BaseTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord, Ref } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

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

describe('stageDeepClone', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseTestCase & {
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
			assert(treeRecord, {
				key: 'ELEMENT_NOT_FOUND',
				detail: 'getTree returned undefined for sourceRef',
				ref: testCase.sourceRef,
			})
			await tx.deepClone(testCase.parentRef, treeRecord)
		})
		return { assertDatabaseName: source.databaseName, withDatabaseIds: true }
	}

	runTestCases({ testCases, dialecteConfig: makeCloneConfig(), act })

	it('returns a CloneResult with the correct source ref and one mapping per cloned element', async () => {
		const xmlString = /* xml */ `
			<Root ${ns}>
				<A ${customId}="a1" aA="parent">
					<AA_1 ${customId}="aa1" aAA_1="l1">
						<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
					</AA_1>
				</A>
			</Root>
		`
		const { document, cleanup } = await createTestDialecte({
			xmlString,
			dialecteConfig: makeCloneConfig(),
		})

		try {
			const treeRecord = await document.query.getTree({ tagName: 'AA_1', id: 'aa1' } as any)

			const result = await document.transaction(async (tx) => {
				return tx.deepClone({ tagName: 'A', id: 'a1' } as any, treeRecord! as any)
			})

			expect(result.record.tagName).toBe('AA_1')
			expect(result.mappings).toHaveLength(2) // AA_1 + AAA_1
		} finally {
			await cleanup()
		}
	})

	it('beforeClone hook can skip elements', async () => {
		const xmlString = /* xml */ `
			<Root ${ns}>
				<A ${customId}="a1" aA="parent">
					<AA_1 ${customId}="aa1" aAA_1="l1">
						<AAA_1 ${customId}="aaa1" aAAA_1="skip-me" />
					</AA_1>
				</A>
			</Root>
		`
		const dialecteConfig = {
			...TEST_DIALECTE_CONFIG,
			hooks: {
				beforeClone: ({ record }: { record: AnyTreeRecord }) => ({
					shouldBeCloned: record.tagName !== 'AAA_1',
					transformedRecord: record,
				}),
			},
		} as typeof TEST_DIALECTE_CONFIG

		const { document, exportCurrentTest, cleanup } = await createTestDialecte({
			xmlString,
			dialecteConfig,
		})

		try {
			const treeRecord = await document.query.getTree({ tagName: 'AA_1', id: 'aa1' } as any)

			await document.transaction(async (tx) => {
				await tx.deepClone({ tagName: 'A', id: 'a1' } as any, treeRecord! as any)
			})

			const { xmlDocument } = await exportCurrentTest({ withDatabaseIds: true })

			// Original AA_1 (id="aa1") still has its AAA_1
			assertExpectedElementQueries({
				xmlDocument,
				queries: ['//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@aAAA_1="skip-me"]'],
			})
			// The clone (any AA_1 that is NOT the original) has no AAA_1 child
			assertUnexpectedElementQueries({
				xmlDocument,
				queries: ['//default:AA_1[not(@_temp-idb-id="aa1")]/default:AAA_1'],
			})
		} finally {
			await cleanup()
		}
	})
})
