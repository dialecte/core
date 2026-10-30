import { childOccurrences } from './child-occurrences'
import { resolveDefinition } from './resolve-definition'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { ChildOccurrences } from './child-occurrences.types'
import type { ResolvableRecord } from './resolve-definition.types'

const XSI = 'http://www.w3.org/2001/XMLSchema-instance'

function record(params: { tagName: string; xsiType?: string }): ResolvableRecord {
	return {
		tagName: params.tagName,
		parent: null,
		attributes: params.xsiType
			? [{ name: 'xsi:type', value: params.xsiType, namespace: { prefix: 'xsi', uri: XSI } }]
			: [],
	}
}

type TestCase = { record: ResolvableRecord; expected: Record<string, ChildOccurrences> }

const testCases: Record<string, TestCase> = {
	'a sequence of required, bounded and absent minOccurs -> each as written, absent minOccurs = 0': {
		record: record({ tagName: 'A' }),
		expected: {
			AA_1: { min: 1, max: 1 },
			AA_2: { min: 0, max: 2 },
			AA_3: { min: 0, max: 3 },
		},
	},
	'an optional choice of two -> each optional, at most once': {
		record: record({ tagName: 'C' }),
		expected: {
			CC_1: { min: 0, max: 1 },
			CC_2: { min: 0, max: 1 },
			CC_3: { min: 0, max: 3 },
		},
	},
	'no content model, children from its variants -> optional, unbounded': {
		record: record({ tagName: 'DD_1' }),
		expected: { DDD_1: { min: 0, max: undefined } },
	},
	'xsi:type naming a variant -> the type content model': {
		record: record({ tagName: 'DD_1', xsiType: 'tDD_1A' }),
		expected: { DDD_1: { min: 1, max: 1 } },
	},
	'only a wildcard -> no named child': {
		record: record({ tagName: 'DDD_2' }),
		expected: {},
	},
}

describe('childOccurrences', () => {
	for (const [name, testCase] of Object.entries(testCases))
		it(name, () => {
			const definition = resolveDefinition({
				dialecteConfig: TEST_DIALECTE_CONFIG,
				record: testCase.record,
			})
			expect(definition).toBeDefined()
			if (definition) expect(childOccurrences({ definition })).toEqual(testCase.expected)
		})

	it('a group repeated 2 to 3 times holding a required child -> 2 to 3, ordered as the children', () => {
		expect(
			childOccurrences({
				definition: {
					children: { sequence: ['B', 'A'], details: {} },
					contentModel: {
						kind: 'sequence',
						minOccurs: 2,
						maxOccurs: 3,
						particles: [
							{ kind: 'element', name: 'A', minOccurs: 1, maxOccurs: 1 },
							{ kind: 'element', name: 'B', minOccurs: 1 },
						],
					},
				},
			}),
		).toEqual({ B: { min: 2, max: undefined }, A: { min: 2, max: 3 } })
	})
})
