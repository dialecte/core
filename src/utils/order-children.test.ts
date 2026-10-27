import { orderByConfigSequence } from './order-children'

import { describe, expect } from 'vitest'

import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyDefinition, ElementDefinition, Particle } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Node = { tagName: string; id: string }

function nodes(...specs: [string, string][]): Node[] {
	return specs.map(([tagName, id]) => ({ tagName, id }))
}

const DEFAULT_URI = 'http://dialecte.dev/XML/DEFAULT'
const EXT_URI = 'http://dialecte.dev/XML/DEV-EXT'

/** A definition entry holding only what ordering reads: its namespace, its sequence and its content model (a wildcard in it, one sequence occurring once, as the generator writes). */
function element(params: {
	tag: string
	uri: string
	sequence?: string[]
	particles?: Particle[]
}): ElementDefinition {
	const { tag, uri, sequence = [], particles } = params
	return {
		tag,
		namespace: { prefix: uri === EXT_URI ? 'ext' : '', uri },
		parents: [],
		attributes: { sequence: [], details: {} },
		children: { sequence, details: {}, ...(particles && { any: true as const }) },
		...(particles && { contentModel: { kind: 'sequence', minOccurs: 1, maxOccurs: 1, particles } }),
	}
}

function definitionOf(...elements: ElementDefinition[]): AnyDefinition {
	return Object.fromEntries(elements.map((entry) => [entry.tag, entry]))
}

const OTHER_THAN_DEFAULT: Particle = {
	kind: 'any',
	notNamespace: ['', DEFAULT_URI],
	processContents: 'lax',
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('orderByConfigSequence', () => {
	type TestCase = BaseTestCase & {
		parentTagName: string
		children: Node[]
		childrenConfig: Record<string, readonly string[]>
		definition?: AnyDefinition
		expected: string[] // resulting ids, in order
	}

	const testCases: Record<string, TestCase> = {
		'reorders children to the declared sequence': {
			parentTagName: 'Root',
			children: nodes(['C', 'c'], ['A', 'a'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B', 'C'] },
			expected: ['a', 'b', 'c'],
		},
		'keeps relative order within the same tagName': {
			parentTagName: 'Root',
			children: nodes(['A', 'a2'], ['A', 'a1'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a2', 'a1', 'b'],
		},
		'appends unknown tags last, preserving their order': {
			parentTagName: 'Root',
			children: nodes(['X', 'x'], ['A', 'a'], ['Y', 'y']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a', 'x', 'y'],
		},
		'already-ordered input is unchanged': {
			parentTagName: 'Root',
			children: nodes(['A', 'a'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a', 'b'],
		},
		'parent with no declared sequence returns input order': {
			parentTagName: 'Root',
			children: nodes(['C', 'c'], ['A', 'a']),
			childrenConfig: {},
			expected: ['c', 'a'],
		},
		'a child the leading wildcard admits → first, before the declared children': {
			parentTagName: 'CC_2',
			children: nodes(['CCC_2', 'c2'], ['CCCC_3', 'w'], ['CCC_1', 'c1']),
			childrenConfig: TEST_DIALECTE_CONFIG.children,
			definition: TEST_DIALECTE_CONFIG.definition,
			expected: ['w', 'c1', 'c2'],
		},
		'a child the wildcard does not admit, or the definition does not declare → last': {
			parentTagName: 'CC_2',
			children: nodes(['Unknown', 'u'], ['A', 'a'], ['CCC_1', 'c1'], ['CCCC_3', 'w']),
			childrenConfig: TEST_DIALECTE_CONFIG.children,
			definition: TEST_DIALECTE_CONFIG.definition,
			expected: ['w', 'c1', 'u', 'a'],
		},
		'a wildcard between declared children → its slot between them': {
			parentTagName: 'Root',
			children: nodes(['B', 'b'], ['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A', 'B'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A', 'B'],
					particles: [
						{ kind: 'element', name: 'A' },
						{ kind: 'choice', particles: [OTHER_THAN_DEFAULT] },
						{ kind: 'element', name: 'B' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['a', 'x', 'b'],
		},
		'a trailing wildcard → after the declared children, before the children no particle admits': {
			parentTagName: 'Root',
			children: nodes(['Unknown', 'u'], ['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [{ kind: 'element', name: 'A' }, OTHER_THAN_DEFAULT],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['a', 'x', 'u'],
		},
		'two wildcards → a child takes the first one admitting its namespace': {
			parentTagName: 'Root',
			children: nodes(['B', 'b'], ['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A', 'B'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A', 'B'],
					particles: [
						{ kind: 'any', namespace: [''], processContents: 'lax' },
						{ kind: 'element', name: 'A' },
						OTHER_THAN_DEFAULT,
						{ kind: 'element', name: 'B' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['a', 'x', 'b'],
		},
		'a declared child a wildcard also admits → at its declared place': {
			parentTagName: 'CC_2',
			children: nodes(['CCC_3', 'c3'], ['CCC_1', 'c1']),
			childrenConfig: TEST_DIALECTE_CONFIG.children,
			definition: TEST_DIALECTE_CONFIG.definition,
			expected: ['c1', 'c3'],
		},
		'two wildcards admitting the same child → the first one': {
			parentTagName: 'Root',
			children: nodes(['B', 'b'], ['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A', 'B'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A', 'B'],
					particles: [
						{ kind: 'any', namespace: [EXT_URI], processContents: 'lax' },
						{ kind: 'element', name: 'A' },
						OTHER_THAN_DEFAULT,
						{ kind: 'element', name: 'B' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['x', 'a', 'b'],
		},
		'a ##any wildcard → admits a child of the parent own namespace': {
			parentTagName: 'Root',
			children: nodes(['A', 'a'], ['Y', 'y']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [
						{ kind: 'any', notNamespace: [], processContents: 'lax' },
						{ kind: 'element', name: 'A' },
					],
				}),
				element({ tag: 'Y', uri: DEFAULT_URI }),
			),
			expected: ['y', 'a'],
		},
		'a wildcard inside nested sequences → its slot before the next declared child': {
			parentTagName: 'Root',
			children: nodes(['B', 'b'], ['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A', 'B'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A', 'B'],
					particles: [
						{ kind: 'element', name: 'A' },
						{
							kind: 'sequence',
							particles: [{ kind: 'sequence', particles: [OTHER_THAN_DEFAULT] }],
						},
						{ kind: 'element', name: 'B' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['a', 'x', 'b'],
		},
		'two admitted children of different tags in one slot → their relative order kept': {
			parentTagName: 'CC_2',
			children: nodes(['CCC_1', 'c1'], ['AA_3', 'w1'], ['CCCC_3', 'w2']),
			childrenConfig: TEST_DIALECTE_CONFIG.children,
			definition: TEST_DIALECTE_CONFIG.definition,
			expected: ['w1', 'w2', 'c1'],
		},
		'a wildcard full (maxOccurs) → the next admitting wildcard takes the rest': {
			parentTagName: 'Root',
			children: nodes(['X', 'x1'], ['A', 'a'], ['X', 'x2']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [
						{ ...OTHER_THAN_DEFAULT, maxOccurs: 1 },
						{ kind: 'element', name: 'A' },
						OTHER_THAN_DEFAULT,
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['x1', 'a', 'x2'],
		},
		'every admitting wildcard full → last, in input order with the unmatched': {
			parentTagName: 'Root',
			children: nodes(['X', 'x1'], ['Unknown', 'u'], ['X', 'x2'], ['A', 'a']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [
						{ ...OTHER_THAN_DEFAULT, maxOccurs: 1 },
						{ kind: 'element', name: 'A' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['x1', 'a', 'u', 'x2'],
		},
		'a wildcard in a repeated group → room for the group maxOccurs times its own': {
			parentTagName: 'Root',
			children: nodes(['X', 'x1'], ['X', 'x2'], ['X', 'x3'], ['A', 'a']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [
						{ kind: 'choice', maxOccurs: 2, particles: [{ ...OTHER_THAN_DEFAULT, maxOccurs: 1 }] },
						{ kind: 'element', name: 'A' },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['x1', 'x2', 'a', 'x3'],
		},
		'a wildcard before a child declared again (A, any, A) → after that child': {
			parentTagName: 'Root',
			children: nodes(['X', 'x'], ['A', 'a']),
			childrenConfig: { Root: ['A'] },
			definition: definitionOf(
				element({
					tag: 'Root',
					uri: DEFAULT_URI,
					sequence: ['A'],
					particles: [
						{ kind: 'element', name: 'A', maxOccurs: 1 },
						OTHER_THAN_DEFAULT,
						{ kind: 'element', name: 'A', maxOccurs: 1 },
					],
				}),
				element({ tag: 'X', uri: EXT_URI }),
			),
			expected: ['a', 'x'],
		},
		'empty children → empty result': {
			parentTagName: 'Root',
			children: [],
			childrenConfig: { Root: ['A', 'B'] },
			expected: [],
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = orderByConfigSequence({
			parentTagName: tc.parentTagName,
			children: tc.children,
			childrenConfig: tc.childrenConfig,
			definition: tc.definition,
		})
		expect(result.map((node) => node.id)).toEqual(tc.expected)
	})
})
