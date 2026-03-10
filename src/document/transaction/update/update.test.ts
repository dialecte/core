import { describe, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createXmlAssertions,
	createTestDialecte,
} from '@/test-fixtures'

import type { UpdateParams } from './update.types'
import type { TestDialecteConfig } from '@/test-fixtures'
import type { Ref } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

describe('stageUpdate', () => {
	type TestCase = {
		description: string
		xmlString: string
		targetRef: Ref<TestDialecteConfig, 'A'> | Ref<TestDialecteConfig, 'B'>
		updateParams: UpdateParams<TestDialecteConfig, 'A'> | UpdateParams<TestDialecteConfig, 'B'>
		expectedElementQueries?: string[]
		unexpectedElementQueries?: string[]
	}

	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const testCases: TestCase[] = [
		{
			description: 'updates single attribute value',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' } },
			expectedElementQueries: ['//default:A[@aA="new"]'],
			unexpectedElementQueries: ['//default:A[@aA="old"]'],
		},
		{
			description: 'updates multiple attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="x" bA="y" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'a', bA: 'b' } },
			expectedElementQueries: ['//default:A[@aA="a"][@bA="b"]'],
			unexpectedElementQueries: ['//default:A[@aA="x"]', '//default:A[@bA="y"]'],
		},
		{
			description: 'removes attribute by setting to null',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: null as any, bA: 'keep' } },
			expectedElementQueries: ['//default:A[@bA="keep"]'],
			unexpectedElementQueries: ['//default:A[@aA]'],
		},
		{
			description: 'removes attribute by setting to undefined',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: undefined, bA: 'keep' } },
			expectedElementQueries: ['//default:A[@bA="keep"]'],
			unexpectedElementQueries: ['//default:A[@aA]'],
		},
		{
			description: 'updates value only',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="attr">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { value: 'new-value' },
			expectedElementQueries: ['//default:A[@aA="attr"][text()="new-value"]'],
			unexpectedElementQueries: ['//default:A[text()="old-value"]'],
		},
		{
			description: 'updates both attributes and value',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' }, value: 'new-value' },
			expectedElementQueries: ['//default:A[@aA="new"][text()="new-value"]'],
			unexpectedElementQueries: ['//default:A[@aA="old"]', '//default:A[text()="old-value"]'],
		},
		{
			description: 'adds new attribute',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="existing" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'new-attr' } },
			expectedElementQueries: ['//default:A[@aA="existing"][@bA="new-attr"]'],
		},
		{
			description: 'unchanged attributes remain',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="keep" bA="change" cA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'changed' } },
			expectedElementQueries: ['//default:A[@aA="keep"][@bA="changed"][@cA="keep"]'],
			unexpectedElementQueries: ['//default:A[@bA="change"]'],
		},
	]

	it.each(testCases)(
		'$description',
		async ({
			xmlString,
			targetRef,
			updateParams,
			expectedElementQueries,
			unexpectedElementQueries,
		}) => {
			const { document, exportCurrentTest, cleanup } = await createTestDialecte({ xmlString })

			try {
				// Perform update in transaction
				await document.transaction(async (tx) => {
					await tx.update(targetRef, updateParams)
				})

				// Verify result
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
})
