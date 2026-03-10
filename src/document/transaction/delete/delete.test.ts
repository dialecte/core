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
import type { Ref, ElementsOf } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

describe('stageDelete', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = {
		description: string
		xmlString: string
		deleteRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectedElementQueries?: string[]
		unexpectedElementQueries?: string[]
	}

	const testCases: TestCase[] = [
		{
			description: 'deletes a leaf element',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedElementQueries: ['//default:A[@aA="target"]'],
		},
		{
			description: 'does not affect sibling elements',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<A ${customId}="a2" aA="sibling" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedElementQueries: ['//default:A[@aA="sibling"]'],
			unexpectedElementQueries: ['//default:A[@aA="target"]'],
		},
		{
			description: 'deletes element together with its direct children',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa1" aAA_1="child" />
					</A>
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedElementQueries: ['//default:A[@aA="parent"]', '//default:AA_1[@aAA_1="child"]'],
		},
		{
			description: 'deletes element together with all its deep descendants',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="level0">
						<AA_1 ${customId}="aa1" aAA_1="level1">
							<AAA_1 ${customId}="aaa1" aAAA_1="level2" />
						</AA_1>
					</A>
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			unexpectedElementQueries: [
				'//default:A[@aA="level0"]',
				'//default:AA_1[@aAA_1="level1"]',
				'//default:AAA_1[@aAAA_1="level2"]',
			],
		},
		{
			description: 'only deletes the targeted subtree, leaving other subtrees intact',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="delete-me">
						<AA_1 ${customId}="aa1" aAA_1="child-of-deleted" />
					</A>
					<B ${customId}="b1" aB="keep-me" />
				</Root>
			`,
			deleteRef: { tagName: 'A', id: 'a1' },
			expectedElementQueries: ['//default:B[@aB="keep-me"]'],
			unexpectedElementQueries: [
				'//default:A[@aA="delete-me"]',
				'//default:AA_1[@aAA_1="child-of-deleted"]',
			],
		},
	]

	it.each(testCases)(
		'$description',
		async ({ xmlString, deleteRef, expectedElementQueries, unexpectedElementQueries }) => {
			const { document, exportCurrentTest, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.delete(deleteRef as any)
				})

				const { xmlDocument } = await exportCurrentTest()

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

	it('throws when attempting to delete the root element', async () => {
		const xmlString = /* xml */ `<Root ${ns} />`
		const { document, cleanup } = await createTestDialecte({ xmlString })

		try {
			await expect(
				document.transaction(async (tx) => {
					const [root] = await document.query.getRecordsByTagName('Root')
					await tx.delete({ tagName: 'Root', id: root.id } as any)
				}),
			).rejects.toThrow()
		} finally {
			await cleanup()
		}
	})
})
