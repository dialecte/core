import { describe, expect, it, afterEach } from 'vitest'

import { createTestProject } from '@/test/create-test-dialecte'

const SIMPLE_XML = /* xml */ `
<Root>
	<A aA="a1" bA="hello" />
</Root>
`

describe('Document.transaction — progress forceClear', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) await p.destroy()
		projects.length = 0
	})

	it('forceClear()s progress even when the callback left an unbalanced plan() on a SUCCESSFUL commit', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			tx.progress.plan({ steps: 5, label: 'Working' }) // never closed by endPlan() — commit still succeeds
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(source.document.state.progress).toBeNull()
	})

	it('does not affect a later, unrelated transaction on the same document', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		await expect(
			source.document.transaction(async (tx) => {
				tx.progress.plan({ steps: 1, label: 'Working' })
				throw new Error('boom')
			}),
		).rejects.toThrow()

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(source.document.state.progress).toBeNull()
	})
})
