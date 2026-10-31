import { CHANGE_TOLD_WITHIN_MS } from '../sqlite/runtime/runtime.fixtures.constants'
import {
	commit,
	contractFile,
	makeBlobEntry,
	makeDocument,
	makeRecord,
} from './store-contract.fixtures'

import { expect, vi } from 'vitest'

import type { Store, StoreNotice } from '../store.types'
import type { StoreContractCase, StoreContractCases } from './store-contract.types'
import type { ProjectChannelMessage } from '@/project/types'

/** Every notice a store tells, in order, kept for the case. */
function heard(params: { store: Store }): StoreNotice[] {
	const notices: StoreNotice[] = []
	params.store.subscribe!(function keep(notice) {
		notices.push(notice)
	})
	return notices
}

/** A notice as a case compares it: its kind, whose change it was, and the event's type and subject. */
function shapeOf(notice: StoreNotice): unknown {
	if (notice.type === 'resync') return { type: 'resync' }
	return { own: notice.own, ...subjectOf({ message: notice.message }) }
}

/** What a message is about: its type and the ids it names, its timestamp left out. */
function subjectOf(params: { message: ProjectChannelMessage }): Record<string, unknown> {
	const { timestamp: _timestamp, ...subject } = params.message
	return subject
}

const DOCUMENT_ID = 'doc-1'

/** A document with one record `r1`, and history: one commit applied (creating `r2`). */
async function seedProject(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
	await store.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'r1' })] })
	await commit({ store, documentId: DOCUMENT_ID, creates: [makeRecord({ id: 'r2' })] })
}

/** A change made through a store, and the event every connection must be told of it. */
type AnnouncedChange = {
	seed?: (params: { store: Store }) => Promise<void>
	change: (params: { store: Store }) => Promise<unknown>
	expected: Record<string, unknown>
}

const ANNOUNCED_CHANGES: Record<string, AnnouncedChange> = {
	'a document registered → init-empty-document': {
		change: ({ store }) => store.registerDocument(makeDocument({ id: 'doc-new' })),
		expected: { type: 'init-empty-document', documentId: 'doc-new' },
	},
	'a document renamed → document-updated': {
		seed: seedProject,
		change: ({ store }) => store.updateDocument(DOCUMENT_ID, { name: 'renamed' }),
		expected: { type: 'document-updated', documentId: DOCUMENT_ID },
	},
	'a document removed → document-removed': {
		seed: seedProject,
		change: ({ store }) => store.removeDocument(DOCUMENT_ID),
		expected: { type: 'document-removed', documentId: DOCUMENT_ID },
	},
	'records written in bulk → commit': {
		seed: seedProject,
		change: ({ store }) => store.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'r3' })] }),
		expected: { type: 'commit', documentId: DOCUMENT_ID },
	},
	'a commit → commit': {
		seed: seedProject,
		change: ({ store }) =>
			commit({ store, documentId: DOCUMENT_ID, creates: [makeRecord({ id: 'r3' })] }),
		expected: { type: 'commit', documentId: DOCUMENT_ID },
	},
	'an undo with something to undo → commit': {
		seed: seedProject,
		change: ({ store }) => store.undo(DOCUMENT_ID),
		expected: { type: 'commit', documentId: DOCUMENT_ID },
	},
	'a redo with something to redo → commit': {
		seed: async function seedUndone({ store }) {
			await seedProject({ store })
			await store.undo(DOCUMENT_ID)
		},
		change: ({ store }) => store.redo(DOCUMENT_ID),
		expected: { type: 'commit', documentId: DOCUMENT_ID },
	},
	'a blob added → blob-added': {
		seed: seedProject,
		change: ({ store }) =>
			store.addBlob(makeBlobEntry({ id: 'blob-1', documentId: DOCUMENT_ID }), new Blob(['x'])),
		expected: { type: 'blob-added', blobId: 'blob-1', documentId: DOCUMENT_ID },
	},
	'a blob attached → blob-attached': {
		seed: async function seedBlob({ store }) {
			await seedProject({ store })
			await store.addBlob(makeBlobEntry({ id: 'blob-1', documentId: DOCUMENT_ID }), new Blob(['x']))
		},
		change: ({ store }) => store.attachBlob('blob-1', { documentId: DOCUMENT_ID, recordRef: 'r1' }),
		expected: {
			type: 'blob-attached',
			blobId: 'blob-1',
			ref: { documentId: DOCUMENT_ID, recordRef: 'r1' },
		},
	},
	'a blob detached → blob-detached': {
		seed: async function seedAttached({ store }) {
			await seedProject({ store })
			await store.addBlob(
				makeBlobEntry({
					id: 'blob-1',
					documentId: DOCUMENT_ID,
					attachedTo: [{ documentId: DOCUMENT_ID, recordRef: 'r1' }],
				}),
				new Blob(['x']),
			)
		},
		change: ({ store }) => store.detachBlob('blob-1', { documentId: DOCUMENT_ID, recordRef: 'r1' }),
		expected: {
			type: 'blob-detached',
			blobId: 'blob-1',
			ref: { documentId: DOCUMENT_ID, recordRef: 'r1' },
		},
	},
	'a blob removed → blob-removed': {
		seed: async function seedBlob({ store }) {
			await seedProject({ store })
			await store.addBlob(makeBlobEntry({ id: 'blob-1', documentId: DOCUMENT_ID }), new Blob(['x']))
		},
		change: ({ store }) => store.removeBlob('blob-1'),
		expected: { type: 'blob-removed', blobId: 'blob-1' },
	},
}

/** A call that changes nothing: no connection is told anything of it. */
const SILENT_CALLS: Record<string, (params: { store: Store }) => Promise<unknown>> = {
	'an undo with nothing to undo': ({ store }) => store.undo('doc-unknown'),
	'a redo with nothing to redo': ({ store }) => store.redo(DOCUMENT_ID),
	'an unknown document removed': ({ store }) => store.removeDocument('doc-unknown'),
	'an unknown document updated': ({ store }) => store.updateDocument('doc-unknown', { name: 'x' }),
	'a document updated to what it holds': ({ store }) =>
		store.updateDocument(DOCUMENT_ID, { name: makeDocument().name }),
	'an empty bulk write': ({ store }) => store.bulkWrite(DOCUMENT_ID, {}),
	'a bulk write deleting only absent records': ({ store }) =>
		store.bulkWrite(DOCUMENT_ID, { deletes: ['absent'] }),
	'an unknown blob removed': ({ store }) => store.removeBlob('blob-unknown'),
	'a document’s metadata written again, its keys in another order': async function sameMetadata({
		store,
	}) {
		await store.updateDocument(DOCUMENT_ID, { metadata: { second: 2, first: 1 } })
	},
	'a blob attached where it is attached already': async function attachAgain({ store }) {
		await store.attachBlob('blob-seed', { documentId: DOCUMENT_ID, recordRef: 'r1' })
	},
	'a blob detached from a record it is not attached to': async function detachAbsent({ store }) {
		await store.detachBlob('blob-seed', { documentId: DOCUMENT_ID, recordRef: 'r2' })
	},
}

function announcedCase(params: { change: AnnouncedChange }): StoreContractCase {
	const { seed, change, expected } = params.change
	return {
		needs: ['second-connection', 'announce'],
		act: async ({ store, connect }) => {
			await seed?.({ store })
			const other = await connect()
			const ownNotices = heard({ store })
			const otherNotices = heard({ store: other })
			await change({ store })
			// the change this connection made: told to it before its call settled
			expect(ownNotices.map(shapeOf)).toEqual([{ own: true, ...expected }])
			await vi.waitFor(
				function toldToTheOther() {
					expect(otherNotices.map(shapeOf)).toEqual([{ own: false, ...expected }])
				},
				{ timeout: CHANGE_TOLD_WITHIN_MS },
			)
		},
	}
}

function silentCase(params: {
	call: (params: { store: Store }) => Promise<unknown>
}): StoreContractCase {
	const { call } = params
	return {
		needs: ['second-connection', 'announce'],
		act: async ({ store, connect }) => {
			await seedProject({ store })
			await store.undo(DOCUMENT_ID)
			await store.redo(DOCUMENT_ID)
			await store.addBlob(
				makeBlobEntry({
					id: 'blob-seed',
					documentId: DOCUMENT_ID,
					attachedTo: [{ documentId: DOCUMENT_ID, recordRef: 'r1' }],
				}),
				new Blob(['seed']),
			)
			await store.updateDocument(DOCUMENT_ID, { metadata: { first: 1, second: 2 } })
			const other = await connect()
			const ownNotices = heard({ store })
			const otherNotices = heard({ store: other })
			await call({ store })
			expect(ownNotices).toEqual([])
			// a change after it: the first the other connection is told (nothing of the call came before)
			await store.registerDocument(makeDocument({ id: 'doc-after' }))
			await vi.waitFor(
				function toldTheChangeOnly() {
					expect(otherNotices.map(shapeOf)).toEqual([
						{ own: false, type: 'init-empty-document', documentId: 'doc-after' },
					])
				},
				{ timeout: CHANGE_TOLD_WITHIN_MS },
			)
		},
	}
}

/** What a store that several connections share tells them of their changes (`subscribe`). */
export const STORE_ANNOUNCE_CONTRACT: Record<string, StoreContractCases> = {
	'each change told to every connection': Object.fromEntries(
		Object.entries(ANNOUNCED_CHANGES).map(function caseOf([description, change]) {
			return [description, announcedCase({ change })]
		}),
	),
	'nothing told of a call that changes nothing': Object.fromEntries(
		Object.entries(SILENT_CALLS).map(function caseOf([description, call]) {
			return [`${description} → nothing told`, silentCase({ call })]
		}),
	),
	'whose change it was': {
		'an import by one connection → document-imported, told to it as its own and to the other as another’s':
			{
				needs: ['second-connection', 'announce', 'import'],
				act: async ({ store, connect }) => {
					const other = await connect()
					const ownNotices = heard({ store })
					const otherNotices = heard({ store: other })
					const { record } = await store.importFile({
						file: contractFile({ body: '<B aB="B0"/>' }),
					})
					const expected = { type: 'document-imported', documentId: record.id }
					expect(ownNotices.map(shapeOf)).toEqual([{ own: true, ...expected }])
					await vi.waitFor(
						function toldToTheOther() {
							expect(otherNotices.map(shapeOf)).toEqual([{ own: false, ...expected }])
						},
						{ timeout: CHANGE_TOLD_WITHIN_MS },
					)
				},
			},
		'two connections of one page (two projects of it) → each told the other’s change as another’s':
			{
				needs: ['second-connection', 'announce'],
				act: async ({ store, connectInRealm }) => {
					const sibling = await connectInRealm()
					const ownNotices = heard({ store })
					const siblingNotices = heard({ store: sibling })
					await sibling.registerDocument(makeDocument({ id: 'doc-sibling' }))
					const expected = { type: 'init-empty-document', documentId: 'doc-sibling' }
					expect(siblingNotices.map(shapeOf)).toEqual([{ own: true, ...expected }])
					await vi.waitFor(
						function toldToTheFirst() {
							expect(ownNotices.map(shapeOf)).toEqual([{ own: false, ...expected }])
						},
						{ timeout: CHANGE_TOLD_WITHIN_MS },
					)
				},
			},
		'a store closed → told nothing of another connection’s change until opened again': {
			needs: ['second-connection', 'announce'],
			act: async ({ store, connect }) => {
				const other = await connect()
				const notices = heard({ store })
				await store.close()
				await other.registerDocument(makeDocument({ id: 'doc-while-closed' }))
				await store.open()
				await other.registerDocument(makeDocument({ id: 'doc-after-open' }))
				await vi.waitFor(
					function toldAfterOpenOnly() {
						expect(notices.map(shapeOf)).toEqual([
							{ own: false, type: 'init-empty-document', documentId: 'doc-after-open' },
						])
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			},
		},
		'a listener unsubscribed → told nothing more': {
			needs: ['announce'],
			act: async ({ store }) => {
				const notices: StoreNotice[] = []
				const unsubscribe = store.subscribe!(function keep(notice) {
					notices.push(notice)
				})
				unsubscribe()
				await store.registerDocument(makeDocument({ id: 'doc-unheard' }))
				expect(notices).toEqual([])
			},
		},
	},
}
