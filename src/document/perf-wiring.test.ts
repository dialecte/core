import { afterEach, describe, expect, it } from 'vitest'

import { createTestProject } from '@/test/create-test-dialecte'

const SIMPLE_XML = /* xml */ `
<Root>
	<A aA="a1" bA="hello" />
</Root>
`

describe('Document/Transaction perf wiring (dev.perf flag)', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) await p.destroy()
		projects.length = 0
		performance.clearMarks()
		performance.clearMeasures()
	})

	it('with dev.perf enabled, tx.perf records spans readable via the shared doc.perf', async () => {
		const { project, source } = await createTestProject({
			sourceXml: SIMPLE_XML,
			dev: { perf: true },
		})
		projects.push(project)

		await source.document.transaction(async (tx) => {
			tx.perf.start('test::op')
			tx.perf.stop('test::op')
		})

		// doc.perf and tx.perf are the SAME project-lived instance
		expect(source.document.perf.report()['test::op'].calls).toBe(1)
	})

	it('with dev.perf disabled/absent, tx.perf is a no-op (report stays empty, nothing on the timeline)', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		await source.document.transaction(async (tx) => {
			tx.perf.start('test::op')
			tx.perf.stop('test::op')
		})

		expect(source.document.perf.report()).toEqual({})
		expect(performance.getEntriesByType('measure')).toHaveLength(0)
	})

	it('exposes the same perf instance on a read-only Query (ctx.perf) as on the Document', async () => {
		const { project, source } = await createTestProject({
			sourceXml: SIMPLE_XML,
			dev: { perf: true },
		})
		projects.push(project)

		expect(source.document.query.perf).toBe(source.document.perf)
	})
})
