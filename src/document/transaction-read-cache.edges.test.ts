import tenAXml from './fixtures/ten-a-elements-holding-v0-to-v9.xml?raw'
import qnameXml from './fixtures/two-e-elements-holding-qname-values.xml?raw'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'
import { callsSince, openCountedProject } from './transaction-read-cache.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreCalls } from './transaction-read-cache.fixtures'
import type { FilterAttributes } from '@/document'
import type { TestDialecteConfig } from '@/test'

/** Each answer as `id status attributes`. */
function shapeOf(
	records: readonly { id: string; status: string; attributes: unknown }[],
): string[] {
	return records.map(
		(record) => `${record.id} ${record.status} ${JSON.stringify(record.attributes)}`,
	)
}

// The edges of the read cache: filters the store's lookup never answers (QName-typed values), a record read alone
// before its tag is read whole, a tag holding no record, and a document large enough to read tags whole later.
describe('transaction read cache - edges', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	type QNameCase = { name: string; filter: FilterAttributes<TestDialecteConfig, 'EE_1'> }
	const qnameCases: QNameCase[] = [
		{ name: 'a QName-typed value alone', filter: { aEE_1: 'xs:integer' } },
		{ name: 'a QName-typed value with a plain one', filter: { aEE_1: '{urn:f}Thing', bEE_1: 'X' } },
	]

	it.each(qnameCases)(
		'$name → the same records before and after the tag is read whole',
		async ({ filter }) => {
			const opened = await openCountedProject({ sourceXml: qnameXml })
			projects.push(opened.project)
			const answers = await opened.document.transaction(async function askAroundCompletion(tx) {
				const fromStore = await tx.findByAttributes({ tagName: 'EE_1', attributes: filter })
				for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
					await tx.findByAttributes({ tagName: 'EE_1', attributes: { bEE_1: `PAD${index}` } })
				}
				const fromMemory = await tx.findByAttributes({ tagName: 'EE_1', attributes: filter })
				return [shapeOf(fromStore), shapeOf(fromMemory)]
			})
			expect(answers[1]).toEqual(answers[0])
			expect(answers[0]).toHaveLength(1)
		},
	)

	it('a record read alone before its tag is read whole → the same records after', async () => {
		const opened = await openCountedProject({ sourceXml: tenAXml })
		projects.push(opened.project)
		const [v3] = await opened.document.query.findByAttributes({
			tagName: 'A',
			attributes: { aA: 'v3' },
		})
		const answers = await opened.document.transaction(async function readAloneThenComplete(tx) {
			await tx.getRecord({ tagName: 'A', id: v3.id })
			const fromStore = await tx.findByAttributes({
				tagName: 'A',
				attributes: { aA: ['v3', 'v4'] },
			})
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `PAD${index}` } })
			}
			const fromMemory = await tx.findByAttributes({
				tagName: 'A',
				attributes: { aA: ['v3', 'v4'] },
			})
			return [shapeOf(fromStore), shapeOf(fromMemory)]
		})
		expect(answers[1]).toEqual(answers[0])
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
