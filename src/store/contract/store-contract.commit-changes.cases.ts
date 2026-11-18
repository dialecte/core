import { CHANGE_TOLD_WITHIN_MS } from '../sqlite/runtime/runtime.fixtures.constants'
import {
	commit,
	deletedRef,
	expectRejectsWith,
	makeDocument,
	makeRecord,
} from './store-contract.fixtures'

import { expect, vi } from 'vitest'

import { COMMIT_CHANGES_MAX } from '@/project/project.constants'

import type { HistoryStep, Store, StoreNotice } from '../store.types'
import type { StoreContractCase, StoreContractCases } from './store-contract.types'
import type { ChangedRecord, CommitChanges, UnknownCommitChanges } from '@/project/types'

const DOCUMENT_ID = 'doc-1'

type Changes = CommitChanges | UnknownCommitChanges

/** p holds d (tag B) and u; nothing in history. */
async function seedFamily(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
	await store.bulkWrite(DOCUMENT_ID, {
		creates: [
			makeRecord({ id: 'p' }),
			makeRecord({ id: 'd', tagName: 'B', parent: { id: 'p', tagName: 'A' } }),
			makeRecord({ id: 'u', parent: { id: 'p', tagName: 'A' } }),
		],
	})
}

/** n (tag C) created under p, u updated, d deleted from p. */
function commitFamily(params: { store: Store }): Promise<void> {
	return commit({
		store: params.store,
		documentId: DOCUMENT_ID,
		creates: [makeRecord({ id: 'n', tagName: 'C', parent: { id: 'p', tagName: 'A' } })],
		updates: [
			makeRecord({
				id: 'u',
				parent: { id: 'p', tagName: 'A' },
				attributes: [{ name: 'a', value: '2' }],
			}),
		],
		deletes: [deletedRef('d', { tagName: 'B', parentId: 'p' })],
	})
}

const N_UNDER_P: ChangedRecord = { id: 'n', tagName: 'C', parentId: 'p' }
const U_UNDER_P: ChangedRecord = { id: 'u', tagName: 'A', parentId: 'p' }
const D_UNDER_P: ChangedRecord = { id: 'd', tagName: 'B', parentId: 'p' }

const FAMILY_COMMITTED: CommitChanges = {
	created: [N_UNDER_P],
	updated: [U_UNDER_P],
	deleted: [D_UNDER_P],
}

const FAMILY_UNDONE: CommitChanges = {
	created: [D_UNDER_P],
	updated: [U_UNDER_P],
	deleted: [N_UNDER_P],
}

/** A step that changed no record: a commit's history keeps no image of an id it did not hold. */
const NOTHING_CHANGED: CommitChanges = { created: [], updated: [], deleted: [] }

/** A record's ref: its id, its tag and its parent's id. */
function refOfRecord(record: ReturnType<typeof makeRecord>): ChangedRecord {
	return { id: record.id, tagName: record.tagName, parentId: record.parent?.id ?? null }
}

function byId(left: { id: string }, right: { id: string }): number {
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** The changes with every list sorted by id: the order inside a list is not the contract. */
function sorted(changes: Changes): Changes {
	if ('unknown' in changes) return changes
	return {
		created: [...changes.created].sort(byId),
		updated: [...changes.updated].sort(byId),
		deleted: [...changes.deleted].sort(byId),
	}
}

/** The changes a step answered, sorted; an answer without changes (`false`) kept as it is. */
function stepped(step: HistoryStep | false): Changes | false {
	return step ? sorted(step.changes) : step
}

/** The changes of every commit message a store tells, sorted, in order. */
function toldChanges(params: { store: Store }): Changes[] {
	const told: Changes[] = []
	params.store.subscribe!(function keep(notice: StoreNotice) {
		if (notice.type === 'change' && notice.message.type === 'commit') {
			told.push(sorted(notice.message.changes))
		}
	})
	return told
}

/** Told to this connection before its call settled, and to the other one soon after. */
function toldToBoth(params: {
	expected: Changes[]
}): (told: { own: Changes[]; other: Changes[] }) => Promise<void> {
	const { expected } = params
	return async function checkTold({ own, other }) {
		expect(own).toEqual(expected)
		await vi.waitFor(
			function toldToTheOther() {
				expect(other).toEqual(expected)
			},
			{ timeout: CHANGE_TOLD_WITHIN_MS },
		)
	}
}

function manyCreates(params: { count: number }): ReturnType<typeof makeRecord>[] {
	return Array.from({ length: params.count }, function created(_, index) {
		return makeRecord({ id: `m${String(index).padStart(5, '0')}` })
	})
}

const ANSWERED: Record<string, StoreContractCase> = {
	'an undo, then a redo → each answers the changeId it was given': {
		act: async ({ store }) => {
			await seedFamily({ store })
			await commitFamily({ store })
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-a' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-b' })
			expect([undone && undone.changeId, redone && redone.changeId]).toEqual(['undo-a', 'redo-b'])
		},
	},
	'an undo or a redo without a changeId → refused STORE_VALUE_NOT_JSON, nothing stepped': {
		act: async ({ store }) => {
			await seedFamily({ store })
			await commitFamily({ store })
			const noId = { documentId: DOCUMENT_ID } as { documentId: string; changeId: string }
			await expectRejectsWith({
				action: store.undo(noId),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /changeId is missing/,
			})
			const afterRefusedUndo = await store.getHistoryStatus(DOCUMENT_ID)
			await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			await expectRejectsWith({
				action: store.redo(noId),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /changeId is missing/,
			})
			const afterRefusedRedo = await store.getHistoryStatus(DOCUMENT_ID)
			const created = await store.get('n', DOCUMENT_ID)
			expect({ afterRefusedUndo, afterRefusedRedo, created }).toEqual({
				afterRefusedUndo: { canUndo: true, canRedo: false },
				afterRefusedRedo: { canUndo: false, canRedo: true },
				created: undefined,
			})
		},
	},
	'an undo → answers the inverse: the deleted created again, the updated with their parent before, the created deleted':
		{
			act: async ({ store }) => {
				await seedFamily({ store })
				await commitFamily({ store })
				const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
				expect(stepped(undone)).toEqual(FAMILY_UNDONE)
			},
		},
	'a redo → answers the commit’s changes': {
		act: async ({ store }) => {
			await seedFamily({ store })
			await commitFamily({ store })
			await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
			expect(stepped(redone)).toEqual(FAMILY_COMMITTED)
		},
	},
	'a delete ref with a wrong tag and parent → the stored record deleted, undone back as stored and answered so':
		{
			act: async ({ store }) => {
				await seedFamily({ store })
				const stored = await store.get('d', DOCUMENT_ID)
				await commit({
					store,
					documentId: DOCUMENT_ID,
					deletes: [deletedRef('d', { tagName: 'Z', parentId: 'elsewhere' })],
				})
				const afterCommit = await store.get('d', DOCUMENT_ID)
				const step = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
				const restored = await store.get('d', DOCUMENT_ID)
				expect({ afterCommit, undone: stepped(step), restored }).toEqual({
					afterCommit: undefined,
					undone: { created: [D_UNDER_P], updated: [], deleted: [] },
					restored: stored,
				})
			},
		},
	'a move between parents, undone → the moved record under its old parent, both parents updated': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			await store.bulkWrite(DOCUMENT_ID, {
				creates: [
					makeRecord({ id: 'p', children: [{ id: 'm', tagName: 'A' }] }),
					makeRecord({ id: 'q' }),
					makeRecord({ id: 'm', parent: { id: 'p', tagName: 'A' } }),
				],
			})
			await commit({
				store,
				documentId: DOCUMENT_ID,
				updates: [
					makeRecord({ id: 'm', parent: { id: 'q', tagName: 'A' } }),
					makeRecord({ id: 'p' }),
					makeRecord({ id: 'q', children: [{ id: 'm', tagName: 'A' }] }),
				],
			})
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			expect(stepped(undone)).toEqual({
				created: [],
				updated: [
					{ id: 'm', tagName: 'A', parentId: 'p' },
					{ id: 'p', tagName: 'A', parentId: null },
					{ id: 'q', tagName: 'A', parentId: null },
				],
				deleted: [],
			})
		},
	},
	'an undo past the cap → answers { unknown: true }': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			await commit({
				store,
				documentId: DOCUMENT_ID,
				creates: manyCreates({ count: COMMIT_CHANGES_MAX + 1 }),
			})
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			expect(stepped(undone)).toEqual({ unknown: true })
		},
	},
	'an undo at exactly the cap, its refs split between creates and updates → answers every ref': {
		act: async ({ store }) => {
			const half = COMMIT_CHANGES_MAX / 2
			const held = manyCreates({ count: half }).map((record) => ({
				...record,
				id: `u${record.id}`,
			}))
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			await store.bulkWrite(DOCUMENT_ID, { creates: held })
			const created = manyCreates({ count: half })
			const updated = held.map((record) => ({ ...record, value: 'updated' }))
			await commit({ store, documentId: DOCUMENT_ID, creates: created, updates: updated })
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			expect(stepped(undone)).toEqual({
				created: [],
				updated: held.map(refOfRecord).sort(byId),
				deleted: created.map(refOfRecord).sort(byId),
			})
		},
	},
	'a redo past the cap → answers { unknown: true }': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			await commit({
				store,
				documentId: DOCUMENT_ID,
				creates: manyCreates({ count: COMMIT_CHANGES_MAX + 1 }),
			})
			await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
			expect(stepped(redone)).toEqual({ unknown: true })
		},
	},
	'a commit deleting an absent id, undone then redone → each step leaves the absent id out': {
		act: async ({ store }) => {
			await seedFamily({ store })
			await commit({ store, documentId: DOCUMENT_ID, deletes: [deletedRef('x')] })
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
			expect([stepped(undone), stepped(redone)]).toEqual([NOTHING_CHANGED, NOTHING_CHANGED])
		},
	},
}

/** A case that sees what this connection and a second one are told while `change` runs. */
function toldCase(params: {
	seed: (params: { store: Store }) => Promise<void>
	change: (params: { store: Store }) => Promise<unknown>
	check: (told: { own: Changes[]; other: Changes[] }) => Promise<void>
}): StoreContractCase {
	const { seed, change, check } = params
	return {
		needs: ['second-connection', 'announce'],
		act: async ({ store, connect }) => {
			await seed({ store })
			const other = await connect()
			const told = { own: toldChanges({ store }), other: toldChanges({ store: other }) }
			await change({ store })
			await check(told)
		},
	}
}

const TOLD: Record<string, StoreContractCase> = {
	'a commit with creates, updates and deletes → its exact changes, the deleted record with the parent it had':
		toldCase({
			seed: seedFamily,
			change: commitFamily,
			check: toldToBoth({ expected: [FAMILY_COMMITTED] }),
		}),
	'an undo, then a redo → each told with the changes it answered': toldCase({
		seed: async function seedCommitted({ store }) {
			await seedFamily({ store })
			await commitFamily({ store })
		},
		change: async function undoThenRedo({ store }) {
			await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
		},
		check: toldToBoth({ expected: [FAMILY_UNDONE, FAMILY_COMMITTED] }),
	}),
	'a delete ref with a wrong tag and parent → told as given, the stored record deleted all the same':
		toldCase({
			seed: seedFamily,
			change: ({ store }) =>
				commit({
					store,
					documentId: DOCUMENT_ID,
					deletes: [deletedRef('d', { tagName: 'Z', parentId: 'elsewhere' })],
				}),
			check: toldToBoth({
				expected: [
					{ created: [], updated: [], deleted: [{ id: 'd', tagName: 'Z', parentId: 'elsewhere' }] },
				],
			}),
		}),
	'an undo past the cap → { unknown: true }': toldCase({
		seed: async function seedPastTheCap({ store }) {
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			await commit({
				store,
				documentId: DOCUMENT_ID,
				creates: manyCreates({ count: COMMIT_CHANGES_MAX + 1 }),
			})
		},
		change: ({ store }) => store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' }),
		check: toldToBoth({ expected: [{ unknown: true }] }),
	}),
	'a commit deleting an absent id, undone then redone → the commit tells it deleted, its steps leave it out':
		toldCase({
			seed: seedFamily,
			change: async function commitThenStep({ store }) {
				await commit({ store, documentId: DOCUMENT_ID, deletes: [deletedRef('x')] })
				await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
				await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
			},
			check: toldToBoth({
				expected: [
					{ created: [], updated: [], deleted: [{ id: 'x', tagName: 'A', parentId: null }] },
					NOTHING_CHANGED,
					NOTHING_CHANGED,
				],
			}),
		}),
	'a commit past the cap → { unknown: true }': toldCase({
		seed: async function seedDocument({ store }) {
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
		},
		change: ({ store }) =>
			commit({
				store,
				documentId: DOCUMENT_ID,
				creates: manyCreates({ count: COMMIT_CHANGES_MAX + 1 }),
			}),
		check: toldToBoth({ expected: [{ unknown: true }] }),
	}),
}

/** What a commit, an undo and a redo changed, as each store answers and tells it. */
export const STORE_COMMIT_CHANGES_CONTRACT: Record<string, StoreContractCases> = {
	'an undo or a redo answers what it applied': ANSWERED,
	'a commit, an undo, a redo told with their changes': TOLD,
}
