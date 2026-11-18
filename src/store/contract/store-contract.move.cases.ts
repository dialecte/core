import { needing } from './store-contract.cases'
import { commit, contractFile, makeDocument, makeRecord } from './store-contract.fixtures'

import { expect } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test/config'
import { XML_DECLARATION } from '@/xml/build/xml-writer.constants'

import type { Store } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { AnyRawRecord, AnyRelationship } from '@/types'

// ── A re-parent: the moved record's parent and both parents' children, in one commit ────────

/** A relationship to one of the seeded records, whose tags are their ids' upper case (`p1` is a `P1`). */
function to(id: string): AnyRelationship {
	return { id, tagName: id.toUpperCase() }
}

/** A seeded record: its parent and children by id, its tag its id's upper case. */
function seeded(params: { id: string; parent: string | null; children?: string[] }): AnyRawRecord {
	const { id, parent, children = [] } = params
	return makeRecord({
		id,
		tagName: id.toUpperCase(),
		parent: parent === null ? null : to(parent),
		children: children.map(to),
	})
}

/** r holds p1 (m, then k) and p2 (t); m holds mc. */
const beforeMove = [
	seeded({ id: 'r', parent: null, children: ['p1', 'p2'] }),
	seeded({ id: 'p1', parent: 'r', children: ['m', 'k'] }),
	seeded({ id: 'p2', parent: 'r', children: ['t'] }),
	seeded({ id: 'm', parent: 'p1', children: ['mc'] }),
	seeded({ id: 'mc', parent: 'm' }),
	seeded({ id: 'k', parent: 'p1' }),
	seeded({ id: 't', parent: 'p2' }),
]

/** The three records a move of m under p2, before t, writes. */
const moveOfM = [
	seeded({ id: 'm', parent: 'p2', children: ['mc'] }),
	seeded({ id: 'p1', parent: 'r', children: ['k'] }),
	seeded({ id: 'p2', parent: 'r', children: ['m', 't'] }),
]

/** Each record's parent id and children ids as the move left them; mc keeps its parent. */
const moved = { m: ['p2', ['mc']], mc: ['m', []], p1: ['r', ['k']], p2: ['r', ['m', 't']] }
const unmoved = { m: ['p1', ['mc']], mc: ['m', []], p1: ['r', ['m', 'k']], p2: ['r', ['t']] }

async function seedAndMove(store: Store): Promise<void> {
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', { creates: beforeMove })
	await commit({ store, documentId: 'doc-1', updates: moveOfM })
}

/**
 * The records m, mc, p1 and p2 through every read path - get, getMany, the document's records, the records of their
 * tag - each as its parent id and its children ids; the four paths must agree.
 */
async function placementsOf(store: Store): Promise<unknown[]> {
	const ids = ['m', 'mc', 'p1', 'p2']
	const byGet = await Promise.all(ids.map((id) => store.get(id, 'doc-1')))
	const byGetMany = await store.getMany(ids, 'doc-1')
	const all = await store.getByDocumentId('doc-1')
	const byDocument = ids.map((id) => all.find((record) => record.id === id))
	const byTag = await Promise.all(
		ids.map(async (id) => (await store.getByTagNameInDocument(id.toUpperCase(), 'doc-1'))[0]),
	)
	return [byGet, byGetMany, byDocument, byTag].map((records) =>
		Object.fromEntries(
			records.map((record) => [
				record?.id,
				[record?.parent?.id, record?.children.map((child) => child.id)],
			]),
		),
	)
}

const reParenting: StoreContractCases = {
	'a re-parent commit → every read path sees the new parent and both children orders': {
		act: async ({ store }) => {
			await seedAndMove(store)
			const placements = await placementsOf(store)
			expect(placements).toEqual([moved, moved, moved, moved])
		},
	},
	'a re-parent commit, reloaded → the new parent and both children orders kept': {
		act: async (context) => {
			await seedAndMove(context.store)
			const reopened = await context.reopen()
			const placements = await placementsOf(reopened)
			expect(placements).toEqual([moved, moved, moved, moved])
		},
	},
}

/** The same commit through the history: undo puts the old placement back, redo the move. */
const reParentingHistory: StoreContractCases = {
	'a re-parent commit undone → the old parent and both children orders back': {
		act: async ({ store }) => {
			await seedAndMove(store)
			await store.undo({ documentId: 'doc-1', changeId: 'undo-1' })
			const placements = await placementsOf(store)
			expect(placements).toEqual([unmoved, unmoved, unmoved, unmoved])
		},
	},
	'a re-parent commit undone then redone → the move applied again': {
		act: async ({ store }) => {
			await seedAndMove(store)
			await store.undo({ documentId: 'doc-1', changeId: 'undo-1' })
			await store.redo({ documentId: 'doc-1', changeId: 'redo-1' })
			const placements = await placementsOf(store)
			expect(placements).toEqual([moved, moved, moved, moved])
		},
	},
}

// ── Export of a moved subtree ────────────────────────────────────────────────

/** p1 holds k1 (an AAA_1 holding kc); p2 holds u, an AAA_2 and no AAA_1. */
const exportSource =
	'<A aA="a"><AA_2 aAA_2="p1"><AAA_1 aAAA_1="k1"><AAAA_1 aAAAA_1="kc"/></AAA_1></AA_2>' +
	'<AA_2 aAA_2="p2"><AAA_2 aAAA_2="u"/></AA_2></A>'

/** k1 and its kc under p2, written before u as the definition orders them, though p2 lists k1 last. */
const exportedAfterMove =
	`${XML_DECLARATION}<Root xmlns="${TEST_DIALECTE_CONFIG.namespaces.default.uri}">` +
	'<A aA="a"><AA_2 aAA_2="p1"/>' +
	'<AA_2 aAA_2="p2"><AAA_1 aAAA_1="k1"><AAAA_1 aAAAA_1="kc"/></AAA_1><AAA_2 aAAA_2="u"/></AA_2></A></Root>'

async function exportedText(params: { store: Store; documentId: string }): Promise<string> {
	const { file } = await params.store.exportFile({
		documentId: params.documentId,
		options: { indent: false },
	})
	return file.text()
}

/** The source imported, then k1 moved under p2 (appended to its children) in one commit; the document's id. */
async function importAndMoveK1(store: Store): Promise<string> {
	const { record } = await store.importFile({ file: contractFile({ body: exportSource }) })
	const documentId = record.id
	const [p1, p2] = await store.getByTagNameInDocument('AA_2', documentId)
	const [k1] = await store.getByTagNameInDocument('AAA_1', documentId)
	const [first, second] = p1.children.some((child) => child.id === k1.id) ? [p1, p2] : [p2, p1]
	await commit({
		store,
		documentId,
		updates: [
			{ ...k1, parent: { id: second.id, tagName: second.tagName } },
			{ ...first, children: first.children.filter((child) => child.id !== k1.id) },
			{ ...second, children: [...second.children, { id: k1.id, tagName: k1.tagName }] },
		],
	})
	return documentId
}

const exportingAMove: StoreContractCases = {
	'the export of a moved subtree → under the new parent, in definition order': {
		act: async ({ store }) => {
			const documentId = await importAndMoveK1(store)
			const exported = await exportedText({ store, documentId })
			expect(exported).toBe(exportedAfterMove)
		},
	},
	'the export of a moved subtree imported again → exported the same': {
		act: async ({ store }) => {
			const documentId = await importAndMoveK1(store)
			const exported = await exportedText({ store, documentId })
			const file = new File([exported], 'again.xml', { type: 'text/xml' })
			const again = await store.importFile({ file })
			const exportedAgain = await exportedText({ store, documentId: again.record.id })
			expect(exportedAgain).toBe(exported)
		},
	},
}

export const STORE_MOVE_CONTRACT: StoreContractGroups = {
	're-parenting a record': reParenting,
	'undoing a re-parent': needing({ needs: ['history'], cases: reParentingHistory }),
	'exporting a moved subtree': needing({ needs: ['import', 'export'], cases: exportingAMove }),
}
