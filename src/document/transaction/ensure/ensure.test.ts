import { describe } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { ActParams, ActResult, BaseTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref } from '@/types'

describe('ensureChild', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const id = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseTestCase & {
		parentRef: Ref<TestDialecteConfig, 'Root' | 'A'>
		childTagName: 'A' | 'AA_2'
		childAttributes: Record<string, string>
	}

	const testCases: TestCases<TestCase> = {
		'singleton — existing → returned, no duplicate': {
			sourceXml: `
				<Root ${ns}>
					<A ${id}="a1" aA="existing" />
				</Root>
			`,
			parentRef: { tagName: 'Root' },
			childTagName: 'A',
			childAttributes: {},
			expectedQueries: ['//default:A[@aA="existing"]'],
			unexpectedQueries: ['//default:A[2]'],
		},

		'singleton — absent → created': {
			sourceXml: `<Root ${ns} />`,
			parentRef: { tagName: 'Root' },
			childTagName: 'A',
			childAttributes: { aA: 'new' },
			expectedQueries: ['//default:A[@aA="new"]'],
		},

		'by attribute value object — match → returned, no duplicate': {
			sourceXml: `
				<Root ${ns}>
					<A ${id}="a1" aA="parent">
						<AA_2 ${id}="aa2-1" aAA_2="42" />
					</A>
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childTagName: 'AA_2',
			childAttributes: { aAA_2: '42' },
			expectedQueries: ['//default:AA_2[@aAA_2="42"]'],
			unexpectedQueries: ['//default:AA_2[2]'],
		},

		'by attribute value object — no match → created': {
			sourceXml: `
				<Root ${ns}>
					<A ${id}="a1" aA="parent">
						<AA_2 ${id}="aa2-1" aAA_2="99" />
					</A>
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childTagName: 'AA_2',
			childAttributes: { aAA_2: '42' },
			expectedQueries: ['//default:AA_2[@aAA_2="99"]', '//default:AA_2[@aAA_2="42"]'],
		},

		'no attributes, no id → absent → created': {
			sourceXml: `
				<Root ${ns}>
					<A ${id}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childTagName: 'AA_2',
			childAttributes: { aAA_2: 'fresh' },
			expectedQueries: ['//default:AA_2[@aAA_2="fresh"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.ensureChild(testCase.parentRef, {
				tagName: testCase.childTagName,
				attributes: testCase.childAttributes as never,
			})
		})
		return { assertDatabaseName: source.databaseName }
	}

	runTestCases({ testCases, act })
})
