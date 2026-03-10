import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createXmlAssertions,
	createTestDialecte,
} from '@/test-fixtures'

import type { TestDialecteConfig } from '@/test-fixtures'
import type { AnyTreeRecord, Ref, ElementsOf } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a test dialecte config with a beforeClone hook that appends a
 * `dev:clone-index` qualified attribute to every cloned element. The value is
 * `${record.id}-${index}`, where index increments per cloned node.
 * This lets tests assert both that the source still exists (via _temp-idb-id)
 * and that the clone also exists (via dev:clone-index).
 */
function makeCloneConfig(): typeof TEST_DIALECTE_CONFIG {
	let index = 0

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
							value: `${record.id}-${index++}`,
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

	type TestCase = {
		description: string
		xmlString: string
		sourceRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		parentRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectedElementQueries?: string[]
		unexpectedElementQueries?: string[]
	}

	const testCases: TestCase[] = [
		{
			description: 'clones a leaf element preserving its attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="leaf" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedElementQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="leaf"]',
				'//default:AA_1[@dev:clone-index="aa1-0"][@aAA_1="leaf"]',
			],
		},
		{
			description: 'original element is preserved after cloning',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="source" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedElementQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="source"]',
				'//default:AA_1[@dev:clone-index="aa1-0"][@aAA_1="source"]',
			],
		},
		{
			description: 'recursively clones direct children',
			xmlString: /* xml */ `
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
			expectedElementQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@_temp-idb-id="aaa1"]',
				'//default:AA_1[@dev:clone-index="aa1-0"]/default:AAA_1[@dev:clone-index="aaa1-1"]',
			],
		},
		{
			description: 'clones all deep descendants',
			xmlString: /* xml */ `
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
			expectedElementQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"]/default:AAA_1[@_temp-idb-id="aaa1"]',
				'//default:AAA_1[@_temp-idb-id="aaa1"]/default:AAAA_1[@_temp-idb-id="aaaa1"]',
				'//default:AA_1[@dev:clone-index="aa1-0"]/default:AAA_1[@dev:clone-index="aaa1-1"]',
				'//default:AAA_1[@dev:clone-index="aaa1-1"]/default:AAAA_1[@dev:clone-index="aaaa1-2"]',
			],
		},
		{
			description: 'does not affect sibling elements of the parent',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="source" />
						<AA_2 ${customId}="aa2" aAA_2="sibling" />
					</A>
				</Root>
			`,
			sourceRef: { tagName: 'AA_1', id: 'aa1' },
			parentRef: { tagName: 'A', id: 'a1' },
			expectedElementQueries: [
				'//default:AA_1[@_temp-idb-id="aa1"][@aAA_1="source"]',
				'//default:AA_1[@dev:clone-index="aa1-0"][@aAA_1="source"]',
				'//default:AA_2[@_temp-idb-id="aa2"][@aAA_2="sibling"]',
			],
			unexpectedElementQueries: ['//default:AA_2/default:AA_1'],
		},
	]

	it.each(testCases)(
		'$description',
		async ({
			xmlString,
			sourceRef,
			parentRef,
			expectedElementQueries,
			unexpectedElementQueries,
		}) => {
			const dialecteConfig = makeCloneConfig()
			const { document, exportCurrentTest, cleanup } = await createTestDialecte({
				xmlString,
				dialecteConfig,
			})

			try {
				const treeRecord = await document.query.getTree(sourceRef as any)

				await document.transaction(async (tx) => {
					await tx.deepClone(parentRef as any, treeRecord! as any)
				})

				const { xmlDocument } = await exportCurrentTest({ withDatabaseIds: true })

				if (expectedElementQueries) {
					assertExpectedElementQueries({ xmlDocument, queries: expectedElementQueries })
				}
				if (unexpectedElementQueries) {
					assertUnexpectedElementQueries({ xmlDocument, queries: unexpectedElementQueries })
				}
			} finally {
				await cleanup()
			}
		},
	)

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

			expect(result.ref.tagName).toBe('AA_1')
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
