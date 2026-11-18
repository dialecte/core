import {
	inMemoryTestStore,
	openOtherProject,
	openScopedProject,
	versionedStore,
	withoutVersionedReads,
} from './read-scope.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { VersionedReadLog } from './read-scope.fixtures'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const XML = /* xml */ `<Root ${ns}><A aA="one"/><A aA="two"/></Root>`

// What keeps a scope from answering stale records: a transaction never uses one, the Project's read epoch voids it
// on every write it makes or folds, and a store answer of another version drops what it held. The store's version is
// frozen where a case shows the epoch alone voiding a scope.
describe('read scope, guards', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	async function open(
		params: { frozen?: boolean; gate?: () => Promise<void>; name?: string } = {},
	) {
		const log: VersionedReadLog = []
		const inner = inMemoryTestStore({ name: params.name ?? crypto.randomUUID() })
		const store = versionedStore({ store: inner, log, frozen: params.frozen, gate: params.gate })
		const opened = await openScopedProject({ store, log, sourceXml: XML })
		projects.push(opened.project)
		return { ...opened, log, store }
	}

	it("a transaction's and a prepared transaction's reads → never a scope", async () => {
		const { document, first, log } = await open()

		await document.transaction(async (tx) => {
			await tx.getRecord(first)
			await tx.probe.readTwice(first)
		})
		const prepared = await document.prepare(async (tx) => {
			await tx.getRecord(first)
		})
		await prepared.query.probe.readTwice(first)
		prepared.discard()
		await document.query.probe.readTwice(first)

		expect(log).toEqual([{ member: 'get', first: first.id }])
	})

	it.each([
		['a commit', 'commit'],
		['a prepared commit', 'prepared'],
		['an undo', 'undo'],
		['a redo', 'redo'],
	] as const)('%s inside a running call → the call’s next read sees the write', async (_, kind) => {
		const { project, document, first, second, log } = await open({ frozen: true })
		function update(value: string) {
			return document.transaction(async (tx) => {
				await tx.update(first, { attributes: { aA: value } })
			})
		}
		if (kind === 'undo') await update('changed')
		if (kind === 'redo') {
			await update('changed')
			await project.undo(document.documentId)
		}
		const writes = {
			commit: () => update('changed'),
			prepared: async () => {
				const prepared = await document.prepare(async (tx) => {
					await tx.update(first, { attributes: { aA: 'changed' } })
				})
				await prepared.commit()
			},
			undo: () => project.undo(document.documentId),
			redo: () => project.redo(document.documentId),
		}
		const expected = kind === 'undo' ? ['changed', 'one'] : ['one', 'changed']
		log.length = 0

		const answer = await document.query.probe.readAround({
			ref: first,
			other: second,
			write: writes[kind],
		})

		expect({ answer, reads: log.filter((read) => read.first === first.id).length }).toEqual({
			answer: expected,
			reads: 2,
		})
	})

	it("a write behind the Project's back during a call → the next store answer drops what the scope held", async () => {
		const { document, first, second, store, log } = await open()
		async function writeBehind() {
			await store.bulkWrite(document.documentId, {
				updates: [{ recordId: first.id, attributes: [{ name: 'aA', value: 'behind' }] }],
			})
		}

		const answer = await document.query.probe.readAround({
			ref: first,
			other: second,
			write: writeBehind,
		})

		expect({ answer, reads: log.filter((read) => read.first === first.id).length }).toEqual({
			answer: ['one', 'behind'],
			reads: 2,
		})
	})

	it('a store answer arriving after the epoch moved → returned, not kept', async () => {
		let release: () => void = () => {}
		let holding = false
		function gate() {
			return holding ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
		}
		const { document, first, second, log } = await open({ frozen: true, gate })
		holding = true

		const call = document.query.probe.readTwice(first)
		await Promise.resolve()
		holding = false
		await document.transaction(async (tx) => {
			await tx.update(second, { attributes: { aA: 'other' } })
		})
		release()
		const [once, twice] = await call

		expect({ once: once?.id, twice: twice?.id, reads: log.length }).toEqual({
			once: first.id,
			twice: first.id,
			reads: 2,
		})
	})

	it('a change folded from another Project → the running call’s next read sees it', async () => {
		const name = crypto.randomUUID()
		const { document, first, second, log } = await open({ frozen: true, name })
		const otherLog: VersionedReadLog = []
		const other = versionedStore({
			store: inMemoryTestStore({ name }),
			log: otherLog,
			frozen: true,
		})
		const otherProject = await openOtherProject({ store: other })
		projects.push(otherProject)
		async function foreignWrite() {
			await otherProject.openDocument(document.documentId).transaction(async (tx) => {
				await tx.update(first, { attributes: { aA: 'foreign' } })
			})
		}

		const answer = await document.query.probe.readAround({
			ref: first,
			other: second,
			write: foreignWrite,
		})

		expect({ answer, reads: log.filter((read) => read.first === first.id).length }).toEqual({
			answer: ['one', 'foreign'],
			reads: 2,
		})
	})

	it('a store without readVersioned → the same answers, no scope', async () => {
		const log: VersionedReadLog = []
		const plain = withoutVersionedReads({ store: inMemoryTestStore({ name: crypto.randomUUID() }) })
		const { project, document, first } = await openScopedProject({
			store: plain,
			log,
			sourceXml: XML,
		})
		projects.push(project)

		const [once, twice] = await document.query.probe.readTwice(first)

		expect({ once: once?.attributes, twice: twice?.attributes, reads: log }).toEqual({
			once: [{ name: 'aA', value: 'one' }],
			twice: [{ name: 'aA', value: 'one' }],
			reads: [],
		})
	})
})
