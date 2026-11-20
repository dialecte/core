import tenAXml from './fixtures/ten-a-elements-holding-v0-to-v9.xml?raw'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'
import { callsSince, openCountedProject } from './transaction-read-cache.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreCalls } from './transaction-read-cache.fixtures.types'

// The edges of the read cache: a tag holding no record, and a document large enough to read tags whole later. The
// edges every store answers (QName and xsi:type filters, another namespace, a record read alone, a move) are in the
// store contract (`store-contract.read-cache.cases.ts`).
describe('transaction read cache - edges', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	it('a tag holding no record → read whole at its 8th lookup, the 9th answers none with no store call', async () => {
		const { project, document, calls } = await openCountedProject({ sourceXml: tenAXml })
		projects.push(project)
		const ninth = await document.transaction(async function lookUpAnEmptyTag(tx) {
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'C', attributes: { aC: `v${index}` } })
			}
			const before = { ...calls }
			const records = await tx.findByAttributes({ tagName: 'C', attributes: { aC: 'v1' } })
			return { records: records.length, calls: callsSince({ calls, before }) }
		})
		expect(ninth).toEqual({
			records: 0,
			calls: { getByAttributes: 0, getByTagNameInDocument: 0, count: 0 },
		})
	})

	it('a document of a million records → the tag read whole at lookup 500, the record count read once', async () => {
		const { project, document, calls } = await openCountedProject({
			sourceXml: tenAXml,
			documentCount: 1_000_000,
		})
		projects.push(project)
		const before = { ...calls }
		const perPhase = await document.transaction(async function lookUpFiveHundredTimes(tx) {
			const phases: StoreCalls[] = []
			let mark = { ...calls }
			for (let index = 1; index <= 501; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index % 10}` } })
				if (index === 499 || index === 500 || index === 501) {
					phases.push(callsSince({ calls, before: mark }))
					mark = { ...calls }
				}
			}
			return phases
		})
		expect({ phases: perPhase, total: callsSince({ calls, before }) }).toEqual({
			phases: [
				{ getByAttributes: 499, getByTagNameInDocument: 0, count: 1 },
				{ getByAttributes: 0, getByTagNameInDocument: 1, count: 0 },
				{ getByAttributes: 0, getByTagNameInDocument: 0, count: 0 },
			],
			total: { getByAttributes: 499, getByTagNameInDocument: 1, count: 1 },
		})
	})
})
