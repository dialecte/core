import { inMemoryTestStore, openScopedProject, versionedStore } from './read-scope.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { VersionedReadLog } from './read-scope.fixtures'
import type { ProjectChannelMessage } from '@/project/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const XML = /* xml */ `<Root ${ns}><A aA="one"/><A aA="two"/></Root>`

/** What the Project does with what other realms tell, and its resync: private, reached as the channel and the store do. */
type ProjectInternals = {
	onChannelMessage: (message: ProjectChannelMessage) => void
	resync: () => Promise<void>
	readEpochOf: (documentId: string) => number
}

// Every path the Project takes after a write lands or is told empties the document's read scopes, the store's version
// frozen so the epoch alone does it: a running call reads the record again after it (two store reads of it, not one).
describe('read scope, void paths', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	async function open(params: { losing?: ReadonlySet<string> } = {}) {
		const log: VersionedReadLog = []
		const inner = inMemoryTestStore({ name: crypto.randomUUID() })
		const store = versionedStore({ store: inner, log, frozen: true, losing: params.losing })
		const opened = await openScopedProject({ store, log, sourceXml: XML })
		projects.push(opened.project)
		return { ...opened, log, internals: opened.project as unknown as ProjectInternals }
	}

	function readsOf(params: { log: VersionedReadLog; id: string }): number {
		return params.log.filter((read) => read.first === params.id).length
	}

	it('the document removed during a call → the call’s next read finds it gone', async () => {
		const { project, document, first, log } = await open()
		async function remove() {
			await project.removeDocument(document.documentId)
		}

		const values = await document.query.probe.readRecordAround({ ref: first, write: remove })

		expect({ values, reads: readsOf({ log, id: first.id }) }).toEqual({
			values: ['one', undefined],
			reads: 2,
		})
	})

	it.each([['init-empty-document'], ['document-imported'], ['commit']] as const)(
		'another realm telling %s of the document during a call → the call reads it again',
		async (type) => {
			const { document, first, log, internals } = await open()
			async function tell() {
				internals.onChannelMessage({ type, documentId: document.documentId, timestamp: Date.now() })
			}

			await document.query.probe.readRecordAround({ ref: first, write: tell })

			expect(readsOf({ log, id: first.id })).toBe(2)
		},
	)

	it('a resync during a call → the call reads the document again', async () => {
		const { document, first, log, internals } = await open()
		async function resync() {
			await internals.resync()
		}

		await document.query.probe.readRecordAround({ ref: first, write: resync })

		expect(readsOf({ log, id: first.id })).toBe(2)
	})

	it('a commit refused with its connection lost, landed → the call’s next read sees it', async () => {
		const { document, first, log } = await open({ losing: new Set(['commit']) })
		async function commitLost() {
			await document
				.transaction(async (tx) => {
					await tx.update(first, { attributes: { aA: 'changed' } })
				})
				.catch(function lost() {})
		}

		const values = await document.query.probe.readRecordAround({ ref: first, write: commitLost })

		expect({ values, reads: readsOf({ log, id: first.id }) }).toEqual({
			values: ['one', 'changed'],
			reads: 2,
		})
	})

	it('an undo refused with its connection lost, landed → the call’s next read sees it', async () => {
		const { project, document, first, log } = await open({ losing: new Set(['undo']) })
		await document.transaction(async (tx) => {
			await tx.update(first, { attributes: { aA: 'changed' } })
		})
		log.length = 0
		async function undoLost() {
			await project.undo(document.documentId).catch(function lost() {})
		}

		const values = await document.query.probe.readRecordAround({ ref: first, write: undoLost })

		expect({ values, reads: readsOf({ log, id: first.id }) }).toEqual({
			values: ['changed', 'one'],
			reads: 2,
		})
	})

	it('a document imported → its read epoch moved', async () => {
		const { project, internals } = await open()

		const { documentId } = await project.importFile(
			new File([XML], 'second.xml', { type: 'text/xml' }),
		)

		expect(internals.readEpochOf(documentId)).toBe(1)
	})
})
