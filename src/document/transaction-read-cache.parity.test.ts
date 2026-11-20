import mixedAXml from './fixtures/seven-a-elements-over-two-attributes-and-one-of-another-namespace.xml?raw'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'
import { openCountedProject } from './transaction-read-cache.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { FilterAttributes, Transaction } from '@/document'
import type { TestDialecteConfig } from '@/test'

/** A filter of `A` as a caller writes it. */
type AFilter = FilterAttributes<TestDialecteConfig, 'A'>

/** One case: the filter asked before the tag completes and again after. */
type Case = { name: string; filter: AFilter }

/** The records answered for `filter` before the tag is read whole and after, each as `id status attributes`. */
async function askAroundCompletion(params: {
	tx: Transaction<TestDialecteConfig>
	filter: AFilter
}): Promise<string[][]> {
	const { tx, filter } = params
	const fromStore = await tx.findByAttributes({ tagName: 'A', attributes: filter })
	for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
		await tx.findByAttributes({ tagName: 'A', attributes: { aA: `PAD${index}` } })
	}
	const fromMemory = await tx.findByAttributes({ tagName: 'A', attributes: filter })
	return [fromStore, fromMemory].map((records) =>
		records.map((record) => `${record.id} ${record.status} ${JSON.stringify(record.attributes)}`),
	)
}

/**
 * Contract: a lookup answered from a tag read whole gives the records the store's lookup gives, in the same order:
 * asked before the tag completes and again after, in one transaction, the two answers are equal.
 */
describe('transaction read cache - the same answer from the store and from a complete tag', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	const cases: Case[] = [
		{ name: 'one value', filter: { aA: 'ONE' } },
		{ name: 'a value list', filter: { aA: ['TWO', 'THREE', 'FIVE'] } },
		{ name: 'two attributes', filter: { aA: 'ONE', bA: 'X' } },
		{ name: 'an attribute of another namespace', filter: { 'ext:cA': 'Z' } as AFilter },
		{ name: 'a value no record holds', filter: { aA: 'NONE' } },
	]

	it.each(cases)('$name → the same records in the same order', async ({ filter }) => {
		const opened = await openCountedProject({ sourceXml: mixedAXml })
		projects.push(opened.project)
		const answers = await opened.document.transaction(async function askBoth(tx) {
			return askAroundCompletion({ tx, filter })
		})
		expect(answers[1]).toEqual(answers[0])
	})
})

/**
 * Contract: over staged writes (a create matching and one not, an update into and out of the filter, a delete of a
 * match), the answer from a complete tag is the store's lookup with the staged writes laid on top: equal to the one
 * asked before the tag completed.
 */
describe('transaction read cache - the same answer over staged writes', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	const cases: Case[] = [
		{ name: 'one value', filter: { aA: 'ONE' } },
		{ name: 'two attributes', filter: { aA: 'ONE', bA: 'X' } },
		{ name: 'a value list', filter: { aA: ['TWO', 'NEW'] } },
	]

	it.each(cases)('$name → the same records in the same order', async ({ filter }) => {
		const opened = await openCountedProject({ sourceXml: mixedAXml })
		projects.push(opened.project)
		const answers = await opened.document.transaction(async function stageThenAskBoth(tx) {
			const [two] = await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'TWO' } })
			const [four] = await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'FOUR' } })
			const [three] = await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'THREE' } })
			await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'ONE', bA: 'X' } })
			await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'NEW' } })
			await tx.update(two, { attributes: { aA: 'ONE' } })
			await tx.update(four, { attributes: { bA: 'Y' } })
			await tx.delete(three)
			return askAroundCompletion({ tx, filter })
		})
		expect(answers[1]).toEqual(answers[0])
	})
})
