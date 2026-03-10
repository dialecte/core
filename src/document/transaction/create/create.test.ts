import { AddChildParams } from './create.types'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createXmlAssertions,
	createTestDialecte,
} from '@/test-fixtures'

import type { TestDialecteConfig } from '@/test-fixtures'
import type { Ref, ElementsOf, ChildrenOf } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

describe('stageAddChild', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = {
		description: string
		xmlString: string
		parentRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		childPayload: AddChildParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			ChildrenOf<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		withDatabaseIds?: boolean
		expectedElementQueries?: string[]
		unexpectedElementQueries?: string[]
	}

	const testCases: TestCase[] = [
		{
			description: 'adds a child with attributes to the parent',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'new-child' } },
			expectedElementQueries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="new-child"]'],
		},
		{
			description: 'returns a ref with the correct tagName',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedElementQueries: ['//default:AA_1[@aAA_1="child"]'],
		},
		{
			description: 'uses provided id when given',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'child' } },
			withDatabaseIds: true,
			expectedElementQueries: ['//default:AA_1[@_temp-idb-id="0-0-0-0-1"]'],
		},
		{
			description: 'parent children list is updated after add',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa-existing" aAA_1="existing" />
					</A>
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_2', attributes: { aAA_2: 'new' } },
			expectedElementQueries: [
				'//default:A[@aA="parent"]/default:AA_1[@aAA_1="existing"]',
				'//default:A[@aA="parent"]/default:AA_2[@aAA_2="new"]',
			],
		},
		{
			description: 'sibling parents are not affected',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<B ${customId}="b1" aB="sibling" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedElementQueries: [
				'//default:A[@aA="target"]/default:AA_1[@aAA_1="child"]',
				'//default:B[@aB="sibling"]',
			],
			unexpectedElementQueries: ['//default:B/default:AA_1'],
		},
		{
			description: 'adds deeply nested child',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="l0">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
						</AA_1>
					</A>
				</Root>
			`,
			parentRef: { tagName: 'AAA_1', id: 'aaa1' },
			childPayload: { tagName: 'AAAA_1', attributes: { aAAAA_1: 'leaf' } },
			expectedElementQueries: ['//default:AAA_1[@aAAA_1="l2"]/default:AAAA_1[@aAAAA_1="leaf"]'],
		},
	]

	it.each(testCases)(
		'$description',
		async ({
			xmlString,
			parentRef,
			childPayload,
			withDatabaseIds,
			expectedElementQueries,
			unexpectedElementQueries,
		}) => {
			const { document, exportCurrentTest, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(parentRef, childPayload)
				})

				const { xmlDocument } = await exportCurrentTest({ withDatabaseIds })

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

	it('throws when parent does not exist', async () => {
		const xmlString = /* xml */ `<Root ${ns} />`
		const { document, cleanup } = await createTestDialecte({ xmlString })

		try {
			await expect(
				document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'non-existent' },
						{ tagName: 'AA_1', attributes: { aAA_1: 'child' } },
					)
				}),
			).rejects.toThrow()
		} finally {
			await cleanup()
		}
	})
})
