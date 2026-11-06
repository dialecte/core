import { projectKeyOf } from './project-key'

import { describe, expect, it } from 'vitest'

describe('a project’s key', () => {
	type TestCase = {
		project: { dialecteId: string; project: string }
		/** another project whose parts, joined as they are, would read the same */
		other: { dialecteId: string; project: string }
		expected: string
	}
	const testCases: Record<string, TestCase> = {
		'a name holding a slash, against a dialecte id holding it → two keys': {
			project: { dialecteId: 'a', project: 'b/c' },
			other: { dialecteId: 'a/b', project: 'c' },
			expected: 'a/b%2Fc',
		},
		'core’s own dialecte against a dialecte `core` with a name under `test/` → two keys': {
			project: { dialecteId: 'core/test', project: 'x' },
			other: { dialecteId: 'core', project: 'test/x' },
			expected: 'core%2Ftest/x',
		},
		'a part holding an escape, against the part it escapes → two keys': {
			project: { dialecteId: 'a%2Fb', project: 'c' },
			other: { dialecteId: 'a/b', project: 'c' },
			expected: 'a%252Fb/c',
		},
	}
	for (const [description, { project, other, expected }] of Object.entries(testCases)) {
		it(description, () => {
			expect(projectKeyOf(project)).toBe(expected)
			expect(projectKeyOf(other)).not.toBe(expected)
		})
	}
})
