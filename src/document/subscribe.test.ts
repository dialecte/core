import { afterEach, describe, expect, it } from 'vitest'

import { createTestProject } from '@/test/create-test-dialecte'

const SIMPLE_XML = /* xml */ `
<Root>
	<A aA="a1" bA="hello" />
</Root>
`

describe('Document.subscribe — reactive state bridge', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) await p.destroy()
		projects.length = 0
	})

	it('fires the callback while a transaction runs (progress/loading mutations)', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		let calls = 0
		source.document.subscribe(() => calls++)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(calls).toBeGreaterThan(0)
	})

	it('stops firing after unsubscribe', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		let calls = 0
		const unsubscribe = source.document.subscribe(() => calls++)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		const afterFirst = calls
		expect(afterFirst).toBeGreaterThan(0)

		unsubscribe()
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a3', bA: 'y' } })
		})

		expect(calls).toBe(afterFirst)
	})

	it('emits a terminal frame (terminal=true) at least once per committed transaction', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const terminals: boolean[] = []
		source.document.subscribe((terminal) => terminals.push(terminal))

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(terminals).toContain(true)
	})

	it('fires the callback on undo and on redo', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		let calls = 0
		source.document.subscribe(() => calls++)

		await project.undo(source.documentId)
		const afterUndo = calls
		expect(afterUndo).toBeGreaterThan(0)

		await project.redo(source.documentId)
		expect(calls).toBeGreaterThan(afterUndo)
	})

	it('does not double-fire a single callback registered once', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		let syncCalls = 0
		// Register the same function reference twice — a Set-backed registry must keep it once.
		const cb = () => syncCalls++
		source.document.subscribe(cb)
		source.document.subscribe(cb)

		// Drive one deterministic notify via undo after a commit.
		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})
		syncCalls = 0
		await project.undo(source.documentId)

		expect(syncCalls).toBe(1)
	})
})
