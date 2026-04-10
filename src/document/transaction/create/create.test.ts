import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { AddChildParams } from './create.types'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref, ElementsOf, ChildrenOf } from '@/types'

describe('stageAddChild', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		parentRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		childPayload: AddChildParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			ChildrenOf<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectThrow?: boolean
	}

	const testCases: TestCases<TestCase> = {
		'add child with attributes → child nested under parent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'new-child' } },
			expectedQueries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="new-child"]'],
		},
		'addChild called → child element exists in exported XML': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedQueries: ['//default:AA_1[@aAA_1="child"]'],
		},
		'child payload with explicit id → child has that id in exported XML': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'child' } },
			expectedQueries: ['//default:AA_1[@_temp-idb-id="0-0-0-0-1"]'],
		},
		'parent with existing child + addChild → both children present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa-existing" aAA_1="existing" />
					</A>
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_2', attributes: { aAA_2: 'new' } },
			expectedQueries: [
				'//default:A[@aA="parent"]/default:AA_1[@aAA_1="existing"]',
				'//default:A[@aA="parent"]/default:AA_2[@aAA_2="new"]',
			],
		},
		'addChild on one parent → sibling parent unchanged': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<B ${customId}="b1" aB="sibling" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedQueries: [
				'//default:A[@aA="target"]/default:AA_1[@aAA_1="child"]',
				'//default:B[@aB="sibling"]',
			],
			unexpectedQueries: ['//default:B/default:AA_1'],
		},
		'deeply nested parent + addChild → child appended at correct depth': {
			sourceXml: /* xml */ `
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
			expectedQueries: ['//default:AAA_1[@aAAA_1="l2"]/default:AAAA_1[@aAAAA_1="leaf"]'],
		},
		'throws when parent does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			parentRef: { tagName: 'A', id: 'non-existent' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectThrow: true,
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const transaction = source.document.transaction(async (tx) => {
			await tx.addChild(testCase.parentRef, testCase.childPayload)
		})
		if (testCase.expectThrow) {
			await expect(transaction).rejects.toThrow()
		} else {
			await transaction
		}
		return { assertDatabaseName: source.databaseName }
	}

	runTestCases.withExport({ testCases, act })
})
