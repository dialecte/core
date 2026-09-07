import { describe, expect, it } from 'vitest'

import { createTestProject } from '@/test'

const SOURCE_XML = /* xml */ `
<Root>
	<A aA="parent">
		<AA_1 aAA_1="one" />
		<AA_1 aAA_1="two" />
	</A>
</Root>
`

describe('stageDeepClone — progress instrumentation', () => {
	it('reports a fine step over the cloned nodes (subtree node count as total)', async () => {
		const { project, source } = await createTestProject({ sourceXml: SOURCE_XML })

		const stepTotals: number[] = []
		// Max step.current observed within the deepClone frame (total === 3 nodes).
		// nextStep is close-previous, so current = COMPLETED nodes → maxes at 2 (the
		// third node's completion is folded into endPlan); the later commit frame has
		// its own total and is ignored here.
		let cloneFrameMaxCurrent = 0
		source.document.subscribe(() => {
			const step = source.document.state.progress?.step
			if (step) {
				stepTotals.push(step.total)
				if (step.total === 3) cloneFrameMaxCurrent = Math.max(cloneFrameMaxCurrent, step.current)
			}
		})

		const [root] = await source.document.query.getRecordsByTagName('Root')
		const [a] = await source.document.query.getRecordsByTagName('A')
		await source.document.transaction(async (tx) => {
			// Open a main plan so the nested deepClone surfaces as `step` (as it does
			// under a real extension's applyPlan); a lone deepClone would be the main.
			tx.progress.plan({ steps: 1, label: 'Cloning' })
			const tree = await tx.getTree(a)
			if (!tree) throw new Error('tree required')
			await tx.deepClone(root, tree)
		})

		// A + two AA_1 = 3 nodes: a step frame of total 3 that steps close-previous.
		expect(stepTotals).toContain(3)
		expect(cloneFrameMaxCurrent).toBe(2)

		await project.destroy()
	})
})
