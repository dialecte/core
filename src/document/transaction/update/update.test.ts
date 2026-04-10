import { describe } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runXmlTestCases } from '@/test'

import type { UpdateParams } from './update.types'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref } from '@/types'

describe('stageUpdate', () => {
	type TestCase = BaseXmlTestCase & {
		targetRef: Ref<TestDialecteConfig, 'A'> | Ref<TestDialecteConfig, 'B'>
		updateParams: UpdateParams<TestDialecteConfig, 'A'> | UpdateParams<TestDialecteConfig, 'B'>
	}

	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	const testCases: TestCases<TestCase> = {
		'attribute updated → new value present, old value absent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' } },
			expectedQueries: ['//default:A[@aA="new"]'],
			unexpectedQueries: ['//default:A[@aA="old"]'],
		},
		'multiple attributes updated → all new values present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="x" bA="y" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'a', bA: 'b' } },
			expectedQueries: ['//default:A[@aA="a"][@bA="b"]'],
			unexpectedQueries: ['//default:A[@aA="x"]', '//default:A[@bA="y"]'],
		},
		'attribute set to null → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: null as any, bA: 'keep' } },
			expectedQueries: ['//default:A[@bA="keep"]'],
			unexpectedQueries: ['//default:A[@aA]'],
		},
		'attribute set to undefined → attribute removed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="value" bA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: undefined, bA: 'keep' } },
			expectedQueries: ['//default:A[@bA="keep"]'],
			unexpectedQueries: ['//default:A[@aA]'],
		},
		'text content updated → new value present, old value absent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="attr">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { value: 'new-value' },
			expectedQueries: ['//default:A[@aA="attr"][text()="new-value"]'],
			unexpectedQueries: ['//default:A[text()="old-value"]'],
		},
		'attribute and value updated → all new values present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="old">old-value</A>
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { aA: 'new' }, value: 'new-value' },
			expectedQueries: ['//default:A[@aA="new"][text()="new-value"]'],
			unexpectedQueries: ['//default:A[@aA="old"]', '//default:A[text()="old-value"]'],
		},
		'new attribute added → all attributes present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="existing" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'new-attr' } },
			expectedQueries: ['//default:A[@aA="existing"][@bA="new-attr"]'],
		},
		'update one attribute → unchanged attributes unaffected': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="element-a" aA="keep" bA="change" cA="keep" />
				</Root>
			`,
			targetRef: { tagName: 'A', id: 'element-a' },
			updateParams: { attributes: { bA: 'changed' } },
			expectedQueries: ['//default:A[@aA="keep"][@bA="changed"][@cA="keep"]'],
			unexpectedQueries: ['//default:A[@bA="change"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		await source.document.transaction(async (tx) => {
			await tx.update(testCase.targetRef, testCase.updateParams)
		})
		return { assertDatabaseName: source.databaseName }
	}

	runXmlTestCases({ testCases, act })
})
