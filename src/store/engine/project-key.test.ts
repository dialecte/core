import { makeDocument } from '../contract/store-contract.fixtures'
import { createInProcessConnector } from '../sqlite/adapter/in-process-link'
import { EngineStore } from './engine-store'
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

	it('two projects whose parts joined as they are would read the same → opened apart: neither holds the other’s documents', async () => {
		const suffix = crypto.randomUUID()
		const first = await openInProcess({ dialecteId: `a-${suffix}`, name: 'b/c' })
		const second = await openInProcess({ dialecteId: `a-${suffix}/b`, name: 'c' })
		try {
			await first.registerDocument(makeDocument({ id: 'first' }))
			expect(await second.getDocuments()).toEqual([])
			await second.registerDocument(makeDocument({ id: 'second' }))
			expect((await first.getDocuments()).map((document) => document.id)).toEqual(['first'])
		} finally {
			await first.destroy()
			await second.destroy()
		}
	})
})

/** An open store of that dialecte and name, its engine in this realm. */
async function openInProcess(params: { dialecteId: string; name: string }): Promise<EngineStore> {
	const { dialecteId, name } = params
	const store = new EngineStore({ name, connector: createInProcessConnector({ name, dialecteId }) })
	await store.open()
	return store
}
