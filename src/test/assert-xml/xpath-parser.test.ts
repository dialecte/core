import { splitXpathIntoSteps } from './xpath-parser'

import { describe, it, expect } from 'vitest'

describe('splitXpathIntoSteps', () => {
	type TestCase = {
		desc: string
		input: string
		expected: string[]
	}

	const testCases: TestCase[] = [
		{
			desc: 'simple descendant chain',
			input: '//A//B//C',
			expected: ['//A', '//A//B', '//A//B//C'],
		},
		{
			desc: 'mixed child and descendant',
			input: '//A/B//C',
			expected: ['//A', '//A/B', '//A/B//C'],
		},
		{
			desc: 'single step (no split)',
			input: '//A[@name="test"]',
			expected: ['//A[@name="test"]'],
		},
		{
			desc: 'slash inside attribute value',
			input: '//A[@path="a/b/c"]//B',
			expected: ['//A[@path="a/b/c"]', '//A[@path="a/b/c"]//B'],
		},
		{
			desc: 'slash inside single-quoted attribute value',
			input: "//A[@path='a/b/c']//B",
			expected: ["//A[@path='a/b/c']", "//A[@path='a/b/c']//B"],
		},
		{
			desc: 'nested predicates with paths',
			input: '//A[B/C]//D',
			expected: ['//A[B/C]', '//A[B/C]//D'],
		},
		{
			desc: 'deeply nested predicates',
			input: '//A[B[C/@attr="val"]]//D',
			expected: ['//A[B[C/@attr="val"]]', '//A[B[C/@attr="val"]]//D'],
		},
		{
			desc: 'following-sibling axis',
			input: '//A/following-sibling::B',
			expected: ['//A', '//A/following-sibling::B'],
		},
		{
			desc: 'not() predicate',
			input: '//A[not(@uuid="x")]//B',
			expected: ['//A[not(@uuid="x")]', '//A[not(@uuid="x")]//B'],
		},
		{
			desc: 'positional predicate',
			input: '//A[2]//B',
			expected: ['//A[2]', '//A[2]//B'],
		},
		{
			desc: 'parenthesized expression at top level',
			input: '(//A/B)[1]',
			expected: ['(//A/B)[1]'],
		},
		{
			desc: 'absolute path from root',
			input: '/A/B/C',
			expected: ['/A', '/A/B', '/A/B/C'],
		},
		{
			desc: 'direct child of descendant',
			input: '//default:Root[@root="1"]/default:A/ext:AA_3[@ext:aAA_3="v3"]',
			expected: [
				'//default:Root[@root="1"]',
				'//default:Root[@root="1"]/default:A',
				'//default:Root[@root="1"]/default:A/ext:AA_3[@ext:aAA_3="v3"]',
			],
		},
		{
			desc: 'parent axis (..) followed by child',
			input: '//default:AAA_1/../default:AA_2',
			expected: ['//default:AAA_1', '//default:AAA_1/..', '//default:AAA_1/../default:AA_2'],
		},
		{
			desc: 'predicate with contains()',
			input: '//A[contains(@name, "/")]//B',
			expected: ['//A[contains(@name, "/")]', '//A[contains(@name, "/")]//B'],
		},
		{
			desc: 'multiple predicates on same step',
			input: '//A[@x="1"][@y="2"]//B[@z="3"]',
			expected: ['//A[@x="1"][@y="2"]', '//A[@x="1"][@y="2"]//B[@z="3"]'],
		},
		{
			desc: 'following-sibling with predicate',
			input: '//default:BB_1[@aBB_1="b1"]/following-sibling::d:BB_1[@aBB_1="b2"]',
			expected: [
				'//default:BB_1[@aBB_1="b1"]',
				'//default:BB_1[@aBB_1="b1"]/following-sibling::d:BB_1[@aBB_1="b2"]',
			],
		},
	]

	testCases.forEach(({ desc, input, expected }) => {
		it(desc, () => {
			const result = splitXpathIntoSteps(input)
			expect(result).toEqual(expected)
		})
	})
})
