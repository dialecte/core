import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestDialecte,
	runXmlTestCases,
} from '@/test'

import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref, ElementsOf } from '@/types'

describe('stageDelete', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		deleteRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
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
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.delete(testCase.deleteRef as any)
		})
		return { assertDatabaseName: source.databaseName }
	}

	runXmlTestCases({ testCases, act })

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
