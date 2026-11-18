import { commit, contractFile, makeDocument, makeRecord } from './store-contract.fixtures'
import { holdContractImport, untilHeld } from './store-contract.import-session'

import { expect } from 'vitest'

import type { Store, StoreVersion, VersionedAnswer, VersionedRead } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'

const DOCUMENT_ID = 'doc-1'

/** `a` of tag `A` holding `a="1"`, `b` of tag `B`. */
const SEEDED = [makeRecord({ id: 'a' }), makeRecord({ id: 'b', tagName: 'B' })]

/** One call of each read member a version is answered with, on the seeded document. */
const READS: VersionedRead[] = [
	{ member: 'get', args: ['a', DOCUMENT_ID] },
	{ member: 'getMany', args: [['b', 'none', 'a'], DOCUMENT_ID] },
	{ member: 'getByTagNameInDocument', args: ['A', DOCUMENT_ID] },
	{
		member: 'getByAttributes',
		args: [{ documentId: DOCUMENT_ID, tagName: 'A', attributes: [{ name: 'a', values: ['1'] }] }],
	},
	{ member: 'getByDocumentId', args: [DOCUMENT_ID] },
]

/** The document registered and holding the seeded records. */
async function seed(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, { creates: SEEDED })
}

/** The document's version, as the store answers it with a read of `a`. */
async function versionOf(params: { store: Store }): Promise<StoreVersion> {
	const { store } = params
	// a leg without the member fails here: its cases run as pending until it serves versioned reads
	const answer = await store.readVersioned!({
		documentId: DOCUMENT_ID,
		read: { member: 'get', args: ['a', DOCUMENT_ID] },
	})
	return answer.version
}

/** What the plain member answers for that read. */
function plainAnswer(params: { store: Store; read: VersionedRead }): Promise<unknown> {
	const { store, read } = params
	const member = store[read.member] as (...args: unknown[]) => Promise<unknown>
	return member.apply(store, read.args)
}

/** The versions read after each write, the first one before any. */
async function versionsAcross(params: {
	store: Store
	writes: ((store: Store) => Promise<unknown>)[]
}): Promise<StoreVersion[]> {
	const { store, writes } = params
	const versions = [await versionOf({ store })]
	for (const write of writes) {
		await write(store)
		const version = await versionOf({ store })
		versions.push(version)
	}
	return versions
}

/** How many distinct versions there are. */
function distinct(params: { versions: StoreVersion[] }): number {
	return new Set(params.versions.map((version) => JSON.stringify(version))).size
}

/** The records of the one document listed, read with its version. */
async function versionedReadOfImported(params: {
	store: Store
}): Promise<VersionedAnswer<'getByDocumentId'>> {
	const { store } = params
	const [listed] = await store.getDocuments()
	return store.readVersioned!({
		documentId: listed!.id,
		read: { member: 'getByDocumentId', args: [listed!.id] },
	})
}

const versionedReads: StoreContractCases = {
	'each read member → its own answer, all with the version of the unchanged document': {
		needs: ['versioned-read'],
		act: async ({ store }) => {
			await seed({ store })
			const expected = await Promise.all(READS.map((read) => plainAnswer({ store, read })))
			const answers = []
			for (const read of READS) {
				const answer = await store.readVersioned!({ documentId: DOCUMENT_ID, read })
				answers.push(answer)
			}
			expect(answers.map((answer) => answer.value)).toEqual(expected)
			expect(distinct({ versions: answers.map((answer) => answer.version) })).toBe(1)
		},
	},
	'a bulk write, a commit, an undo, a redo → each read after it carries a version never answered before':
		{
			needs: ['versioned-read', 'history'],
			act: async ({ store }) => {
				await seed({ store })
				const versions = await versionsAcross({
					store,
					writes: [
						(target) => target.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'c' })] }),
						(target) =>
							commit({
								store: target,
								documentId: DOCUMENT_ID,
								creates: [makeRecord({ id: 'd' })],
							}),
						(target) => target.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' }),
						(target) => target.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' }),
					],
				})
				expect(distinct({ versions })).toBe(5)
			},
		},
	'the document removed and registered again → a version never answered before': {
		needs: ['versioned-read'],
		act: async ({ store }) => {
			await seed({ store })
			const versions = await versionsAcross({
				store,
				writes: [
					async (target) => {
						await target.removeDocument(DOCUMENT_ID)
						await target.registerDocument(makeDocument())
					},
				],
			})
			expect(distinct({ versions })).toBe(2)
		},
	},
	'a commit through a second connection → the next read answers it, with a version never answered before':
		{
			needs: ['versioned-read', 'second-connection'],
			act: async ({ store, connect }) => {
				await seed({ store })
				const before = await versionOf({ store })
				const other = await connect()
				await commit({ store: other, documentId: DOCUMENT_ID, creates: [makeRecord({ id: 'c' })] })
				const after = await store.readVersioned!({
					documentId: DOCUMENT_ID,
					read: { member: 'get', args: ['c', DOCUMENT_ID] },
				})
				expect(after.value?.id).toBe('c')
				expect(after.version).not.toEqual(before)
			},
		},
	'a read with a write sent right behind it → its answer and its version of one moment': {
		needs: ['versioned-read'],
		act: async ({ store }) => {
			await seed({ store })
			const before = await versionOf({ store })
			const reading = store.readVersioned!({
				documentId: DOCUMENT_ID,
				read: { member: 'getByDocumentId', args: [DOCUMENT_ID] },
			})
			const writing = store.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'c' })] })
			const [read] = await Promise.all([reading, writing])
			const after = await versionOf({ store })
			const ids = read.value.map((record) => record.id)
			// answered before the write: its version is the one before; after it: the one after
			expect(read.version).toEqual(ids.includes('c') ? after : before)
		},
	},
	'a write after the store opened again → a version never answered before': {
		needs: ['versioned-read'],
		act: async ({ store, reopen }) => {
			await seed({ store })
			const versions = await versionsAcross({
				store,
				writes: [(target) => target.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'c' })] })],
			})
			const reopened = await reopen()
			await reopened.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'd' })] })
			const reopenedVersion = await versionOf({ store: reopened })
			versions.push(reopenedVersion)
			expect(distinct({ versions })).toBe(3)
		},
	},
	"an import's writes after a read → a version other than the one read while it ran": {
		needs: ['versioned-read', 'import'],
		act: async ({ store }) => {
			const hold = holdContractImport()
			const importing = store.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			})
			let during: VersionedAnswer<'getByDocumentId'>
			try {
				await untilHeld({ hold, importing })
				during = await versionedReadOfImported({ store })
			} finally {
				hold.release()
			}
			await importing
			const after = await versionedReadOfImported({ store })
			expect(after.version).not.toEqual(during.version)
		},
	},
}

/** The versioned reads of a store that has them: one answer and the document's version of one moment, on every link. */
export const STORE_VERSIONED_READ_CONTRACT: StoreContractGroups = {
	'versioned reads': versionedReads,
}
