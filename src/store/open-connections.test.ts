import { createOpenConnections } from './open-connections'

import { describe, expect, it } from 'vitest'

describe('createOpenConnections', () => {
	/** One step on the count: a connection (by its index) of a name marked open or closed. */
	type Step = { mark: 'open' | 'closed'; name: string; connection: number }
	type TestCase = {
		steps: Step[]
		/** The count asked for: of a name, besides a connection (by its index) or of every one. */
		asked: { name: string; connection?: number }
		expected: number
	}
	const testCases: Record<string, TestCase> = {
		'nothing marked → none open': {
			steps: [],
			asked: { name: 'a' },
			expected: 0,
		},
		'two connections of a name open, every one asked → 2': {
			steps: [
				{ mark: 'open', name: 'a', connection: 0 },
				{ mark: 'open', name: 'a', connection: 1 },
			],
			asked: { name: 'a' },
			expected: 2,
		},
		'two open, besides one of them → 1': {
			steps: [
				{ mark: 'open', name: 'a', connection: 0 },
				{ mark: 'open', name: 'a', connection: 1 },
			],
			asked: { name: 'a', connection: 0 },
			expected: 1,
		},
		'one open, besides a connection not open → 1': {
			steps: [{ mark: 'open', name: 'a', connection: 0 }],
			asked: { name: 'a', connection: 1 },
			expected: 1,
		},
		'a connection marked open twice → counted once': {
			steps: [
				{ mark: 'open', name: 'a', connection: 0 },
				{ mark: 'open', name: 'a', connection: 0 },
			],
			asked: { name: 'a' },
			expected: 1,
		},
		'open, then closed → none open': {
			steps: [
				{ mark: 'open', name: 'a', connection: 0 },
				{ mark: 'closed', name: 'a', connection: 0 },
			],
			asked: { name: 'a' },
			expected: 0,
		},
		'a connection never opened marked closed → the others still counted': {
			steps: [
				{ mark: 'open', name: 'a', connection: 0 },
				{ mark: 'closed', name: 'a', connection: 1 },
			],
			asked: { name: 'a' },
			expected: 1,
		},
		'connections of another name → not counted': {
			steps: [
				{ mark: 'open', name: 'b', connection: 0 },
				{ mark: 'open', name: 'b', connection: 1 },
			],
			asked: { name: 'a' },
			expected: 0,
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			const connections = [{}, {}]
			const open = createOpenConnections()
			for (const step of testCase.steps) {
				const params = { name: step.name, connection: connections[step.connection]! }
				if (step.mark === 'open') open.markOpen(params)
				else open.markClosed(params)
			}
			const { name, connection } = testCase.asked
			const others = open.others({
				name,
				...(connection !== undefined && { connection: connections[connection] }),
			})
			expect(others).toBe(testCase.expected)
		})
	}
})
