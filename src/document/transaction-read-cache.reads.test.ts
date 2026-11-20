import tenAXml from './fixtures/ten-a-elements-holding-v0-to-v9.xml?raw'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'
import { callsSince, openCountedProject } from './transaction-read-cache.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreCalls } from './transaction-read-cache.fixtures'
import type { AnyRawRecord } from '@/types'

/** The `aA` values of records, in the order answered. */
function valuesOf(records: readonly AnyRawRecord[]): string[] {
	return records.map(
		(record) => record.attributes.find((attribute) => attribute.name === 'aA')?.value ?? '',
	)
}

// A transaction asking one tag by attribute values: the first lookups ask the store one each, the lookup at the
// threshold reads the tag once, every later lookup and tag read of it answers from memory.
describe('transaction read cache - the store calls of repeated lookups of one tag', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	async function open() {
		const opened = await openCountedProject({ sourceXml: tenAXml })
		projects.push(opened.project)
		return opened
	}

	it('ten lookups of A → one store lookup each up to the threshold, then one tag read, then none', async () => {
		const { document, calls } = await open()
		const perLookup: StoreCalls[] = []
		await document.transaction(async function lookTenTimes(tx) {
			for (let index = 0; index < 10; index++) {
				const before = { ...calls }
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index}` } })
				perLookup.push(callsSince({ calls, before }))
			}
		})
		const store = { getByAttributes: 1, getByTagNameInDocument: 0, count: 0 }
		const completing = { getByAttributes: 0, getByTagNameInDocument: 1, count: 1 }
		const memory = { getByAttributes: 0, getByTagNameInDocument: 0, count: 0 }
		expect(perLookup).toEqual([
			...Array.from({ length: COMPLETE_TAG_AT_LOOKUP - 1 }, () => store),
			completing,
			...Array.from({ length: 10 - COMPLETE_TAG_AT_LOOKUP }, () => memory),
		])
	})

	it('one lookup in a transaction → one store lookup, nothing else', async () => {
		const { document, calls } = await open()
		await document.transaction(async function lookOnce(tx) {
			await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v1' } })
		})
		expect(calls).toEqual({ getByAttributes: 1, getByTagNameInDocument: 0, count: 0 })
	})

	it('a tag read of a complete tag → no store call, its records with the staged writes', async () => {
		const { document, calls } = await open()
		const answer = await document.transaction(async function completeThenReadTag(tx) {
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index}` } })
			}
			await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'v10' } })
			const before = { ...calls }
			const records = await tx.getRecordsByTagName('A')
			return { records: valuesOf(records).sort(), calls: callsSince({ calls, before }) }
		})
		expect(answer).toEqual({
			records: ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10'].sort(),
			calls: { getByAttributes: 0, getByTagNameInDocument: 0, count: 0 },
		})
	})

	it('one lookup asked before and after the tag completes, over staged writes → the same records in the same order', async () => {
		const { document } = await open()
		const filter = { aA: ['v1', 'v2', 'v3', 'v9', 'new'] }
		const answers = await document.transaction(async function askAroundCompletion(tx) {
			const [v2] = await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v2' } })
			const [v3] = await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v3' } })
			await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'v1' } })
			await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'new' } })
			await tx.update(v2, { attributes: { aA: 'v9' } })
			await tx.delete(v3)
			const fromStore = await tx.findByAttributes({ tagName: 'A', attributes: filter })
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index}` } })
			}
			const fromMemory = await tx.findByAttributes({ tagName: 'A', attributes: filter })
			return {
				fromStore: fromStore.map((record) => `${record.id} ${record.status}`),
				fromMemory: fromMemory.map((record) => `${record.id} ${record.status}`),
				values: valuesOf(fromMemory),
			}
		})
		expect(answers.fromMemory).toEqual(answers.fromStore)
		expect([...answers.values].sort()).toEqual(['new', 'v1', 'v1', 'v9', 'v9'])
	})
})
