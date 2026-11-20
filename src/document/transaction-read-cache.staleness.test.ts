import tenAXml from './fixtures/ten-a-elements-holding-v0-to-v9.xml?raw'
import { inMemoryTestStore, openOtherProject } from './query/read-scope/read-scope.fixtures'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'
import { callsSince, holdOf, openCountedProject } from './transaction-read-cache.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreHold } from './transaction-read-cache.fixtures.types'
import type { ProjectChannelMessage } from '@/project/types'

/** What the Project does with what another realm tells: private, reached as the channel does. */
type ProjectInternals = { onChannelMessage: (message: ProjectChannelMessage) => void }

// The cache lives for one transaction: a commit of another view told on the project channel empties it (the record
// cache with it), and nothing is carried from one transaction to the next.
describe('transaction read cache - what another view commits, and the next transaction', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	/** A project of ten A elements, and a second Project over the same store state that commits as another view would. */
	async function openWithAnotherView(params: { hold?: StoreHold } = {}) {
		const opened = await openCountedProject({ sourceXml: tenAXml, hold: params.hold })
		const otherProject = await openOtherProject({ store: inMemoryTestStore({ name: opened.name }) })
		projects.push(opened.project, otherProject)
		const other = otherProject.openDocument(opened.document.documentId)
		const internals = opened.project as unknown as ProjectInternals
		/** The other view commits `write`, and the commit is told on this Project's channel. */
		async function commitFromAnotherView(
			write: Parameters<typeof other.transaction>[0],
		): Promise<void> {
			await other.transaction(write)
			internals.onChannelMessage({
				type: 'commit',
				documentId: opened.document.documentId,
				timestamp: Date.now(),
				changeId: crypto.randomUUID(),
				changes: { unknown: true },
			} as ProjectChannelMessage)
		}
		return { ...opened, commitFromAnotherView }
	}

	it('a tag completed, then another view commits a record of it → the next lookup finds that record', async () => {
		const { document, commitFromAnotherView } = await openWithAnotherView()
		const found = await document.transaction(async function lookAroundAForeignCommit(tx) {
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'foreign' } })
			}
			await commitFromAnotherView(async function addForeign(otherTx) {
				await otherTx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'foreign' } })
			})
			return tx.findByAttributes({ tagName: 'A', attributes: { aA: 'foreign' } })
		})
		expect(found).toHaveLength(1)
	})

	it('a tag being read whole when another view commits, the cache emptied before the read lands → the next lookup finds the record', async () => {
		const held = holdOf({ member: 'getByTagNameInDocument' })
		const { document, commitFromAnotherView } = await openWithAnotherView({ hold: held.hold })
		const found = await document.transaction(async function completeAcrossAForeignCommit(tx) {
			for (let index = 1; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'foreign' } })
			}
			held.hold.armed = true
			const completing = tx.findByAttributes({ tagName: 'A', attributes: { aA: 'foreign' } })
			await held.reached
			await commitFromAnotherView(async function addForeign(otherTx) {
				await otherTx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'foreign' } })
			})
			// a read after the told change: the transaction's cache is emptied while the tag read is in flight
			await tx.getRecordsByTagName('B')
			held.release()
			await completing
			return tx.findByAttributes({ tagName: 'A', attributes: { aA: 'foreign' } })
		})
		expect(found).toHaveLength(1)
	})

	it('a lookup answering while another view changes its record, the cache emptied before it lands → a read of the record after it, the new value', async () => {
		const held = holdOf({ member: 'getByAttributes' })
		const { document, commitFromAnotherView } = await openWithAnotherView({ hold: held.hold })
		const [stored] = await document.query.findByAttributes({
			tagName: 'A',
			attributes: { aA: 'v4' },
		})
		const ref = { tagName: 'A' as const, id: stored.id }
		const value = await document.transaction(async function lookUpAcrossAForeignCommit(tx) {
			held.hold.armed = true
			const lookup = tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v4' } })
			await held.reached
			await commitFromAnotherView(async function changeIt(otherTx) {
				await otherTx.update(ref, { attributes: { aA: 'changed' } })
			})
			// a read after the told change: the transaction's cache is emptied while the lookup is in flight
			await tx.getRecordsByTagName('B')
			held.release()
			await lookup
			return tx.getAttribute(ref, { name: 'aA' })
		})
		expect(value).toBe('changed')
	})

	it('a record read, then another view changes it → read again, the new value', async () => {
		const { document, commitFromAnotherView } = await openWithAnotherView()
		const [stored] = await document.query.findByAttributes({
			tagName: 'A',
			attributes: { aA: 'v4' },
		})
		// a ref, not the record: a record held is read as given, a ref is read through the transaction
		const ref = { tagName: 'A' as const, id: stored.id }
		const values = await document.transaction(async function readAroundAForeignCommit(tx) {
			const before = await tx.getAttribute(ref, { name: 'aA' })
			await commitFromAnotherView(async function changeIt(otherTx) {
				await otherTx.update(ref, { attributes: { aA: 'changed' } })
			})
			const after = await tx.getAttribute(ref, { name: 'aA' })
			return [before, after]
		})
		expect(values).toEqual(['v4', 'changed'])
	})

	it('a transaction after one that completed the tag → its first lookup asks the store again', async () => {
		const { document, calls } = await openWithAnotherView()
		await document.transaction(async function completeTheTag(tx) {
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index}` } })
			}
		})
		const before = { ...calls }
		await document.transaction(async function lookOnce(tx) {
			await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v1' } })
		})
		expect(callsSince({ calls, before })).toEqual({
			getByAttributes: 1,
			getByTagNameInDocument: 0,
			count: 0,
		})
	})

	it('a prepared transaction that completed the tag, discarded → the next transaction asks the store again', async () => {
		const { document, calls } = await openWithAnotherView()
		const prepared = await document.prepare(async function completeTheTag(tx) {
			for (let index = 0; index < COMPLETE_TAG_AT_LOOKUP; index++) {
				await tx.findByAttributes({ tagName: 'A', attributes: { aA: `v${index}` } })
			}
		})
		prepared.discard()
		const before = { ...calls }
		await document.transaction(async function lookOnce(tx) {
			await tx.findByAttributes({ tagName: 'A', attributes: { aA: 'v1' } })
		})
		expect(callsSince({ calls, before })).toEqual({
			getByAttributes: 1,
			getByTagNameInDocument: 0,
			count: 0,
		})
	})
})
