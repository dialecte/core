import { requiredChoices } from './required-choices'
import { resolveDefinition } from './resolve-definition'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { RequiredChoice } from './required-choices.types'
import type { Particle } from '@/types'

describe('requiredChoices', () => {
	type TestCase = { tagName: string; expected: readonly RequiredChoice[] }

	const testCases: Record<string, TestCase> = {
		'a sequence without a choice -> none': { tagName: 'A', expected: [] },
		'an optional choice -> none: leaving it out is valid': { tagName: 'C', expected: [] },
		'no content model -> none': { tagName: 'DD_1', expected: [] },
	}

	for (const [name, testCase] of Object.entries(testCases))
		it(`${name} (core test dialecte)`, () => {
			const definition = resolveDefinition({
				dialecteConfig: TEST_DIALECTE_CONFIG,
				record: { tagName: testCase.tagName, parent: null, attributes: [] },
			})
			expect(definition).toBeDefined()
			if (definition) expect(requiredChoices({ definition })).toEqual(testCase.expected)
		})

	type ModelCase = { contentModel: Particle; expected: readonly RequiredChoice[] }

	const modelCases: Record<string, ModelCase> = {
		'a required choice of two -> its branches in order, each with how often it holds its child': {
			contentModel: {
				kind: 'sequence',
				minOccurs: 1,
				maxOccurs: 1,
				particles: [
					{
						kind: 'choice',
						minOccurs: 1,
						particles: [
							{ kind: 'element', name: 'X', minOccurs: 1, maxOccurs: 1 },
							{ kind: 'element', name: 'Y', minOccurs: 1, maxOccurs: 1 },
						],
					},
					{ kind: 'element', name: 'Z', minOccurs: 0, maxOccurs: 1 },
				],
			},
			expected: [
				{
					min: 1,
					branches: [
						{ children: { X: { min: 1, max: 1 } }, choices: [] },
						{ children: { Y: { min: 1, max: 1 } }, choices: [] },
					],
				},
			],
		},
		'a branch holding a sequence and a required choice of its own -> both, nested': {
			contentModel: {
				kind: 'choice',
				minOccurs: 2,
				maxOccurs: 2,
				particles: [
					{
						kind: 'sequence',
						minOccurs: 1,
						maxOccurs: 1,
						particles: [
							{ kind: 'element', name: 'X', minOccurs: 1, maxOccurs: 1 },
							{
								kind: 'choice',
								minOccurs: 1,
								maxOccurs: 1,
								particles: [
									{ kind: 'element', name: 'P', minOccurs: 1, maxOccurs: 1 },
									{ kind: 'element', name: 'Q', minOccurs: 1, maxOccurs: 1 },
								],
							},
						],
					},
					{ kind: 'element', name: 'Y', minOccurs: 1, maxOccurs: 1 },
				],
			},
			expected: [
				{
					min: 2,
					branches: [
						{
							children: {
								X: { min: 1, max: 1 },
								P: { min: 0, max: 1 },
								Q: { min: 0, max: 1 },
							},
							choices: [
								{
									min: 1,
									branches: [
										{ children: { P: { min: 1, max: 1 } }, choices: [] },
										{ children: { Q: { min: 1, max: 1 } }, choices: [] },
									],
								},
							],
						},
						{ children: { Y: { min: 1, max: 1 } }, choices: [] },
					],
				},
			],
		},
		'a required choice inside an optional sequence -> none': {
			contentModel: {
				kind: 'sequence',
				minOccurs: 0,
				particles: [
					{
						kind: 'choice',
						minOccurs: 1,
						particles: [
							{ kind: 'element', name: 'X', minOccurs: 1, maxOccurs: 1 },
							{ kind: 'element', name: 'Y', minOccurs: 1, maxOccurs: 1 },
						],
					},
				],
			},
			expected: [],
		},
		'a required choice in a sequence repeated twice -> required twice': {
			contentModel: {
				kind: 'sequence',
				minOccurs: 2,
				maxOccurs: 2,
				particles: [
					{
						kind: 'choice',
						minOccurs: 1,
						maxOccurs: 1,
						particles: [{ kind: 'element', name: 'X', minOccurs: 1, maxOccurs: 1 }],
					},
				],
			},
			expected: [{ min: 2, branches: [{ children: { X: { min: 1, max: 1 } }, choices: [] }] }],
		},
	}

	for (const [name, modelCase] of Object.entries(modelCases))
		it(name, () => {
			expect(requiredChoices({ definition: { contentModel: modelCase.contentModel } })).toEqual(
				modelCase.expected,
			)
		})
})
