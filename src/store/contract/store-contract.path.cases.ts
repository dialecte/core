import { needing } from './store-contract.cases'
import {
	CONTRACT_SESSION_FAIL_VALUE,
	CONTRACT_SESSION_HOLD_VALUE,
} from './store-contract.constants'
import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	sessionRecords,
} from './store-contract.fixtures'
import { holdContractImport, untilHeld } from './store-contract.import-session'

import { expect } from 'vitest'

import { toDialecteError } from '@/errors'

import type { Store } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'

/** A document of the contract's extension (`.xml`) at `path`, its name the path's file name less the extension. */
function documentAt(
	params: { id: string; path: string } & Partial<DocumentRecord>,
): DocumentRecord {
	const { id, path, ...overrides } = params
	const fileName = path.split('/').pop()!
	return makeDocument({ id, name: fileName.replace(/\.xml$/, ''), path, ...overrides })
}

/** The ids of the registered documents, in id order. */
async function registeredIds(store: Store): Promise<string[]> {
	return (await store.getDocuments()).map((document) => document.id)
}

const registering: StoreContractCases = {
	'a document registered with a path → read back with it, listed with it, and after a reopen': {
		act: async ({ store, reopen }) => {
			const document = documentAt({ id: 'doc-1', path: 'substations/north.xml' })
			await store.registerDocument(document)
			expect(await store.getDocument('doc-1')).toEqual(document)
			expect(await store.getDocuments()).toEqual([document])
			const reopened = await reopen()
			expect(await reopened.getDocument('doc-1')).toEqual(document)
		},
	},
	'a path not ending with the document’s file name → DOCUMENT_PATH_INVALID, nothing registered': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.registerDocument(
					makeDocument({ name: 'north', path: 'substations/south.xml' }),
				),
				key: 'DOCUMENT_PATH_INVALID',
				meta: { path: 'substations/south.xml' },
			})
			expect(await store.getDocuments()).toEqual([])
		},
	},
	...Object.fromEntries(
		Object.entries({
			'a leading separator': '/north.xml',
			'a folder ".."': 'a/../north.xml',
			null: null,
		}).map(([form, path]) => [
			`a path with ${form} → DOCUMENT_PATH_INVALID, nothing registered`,
			{
				act: async ({ store }: { store: Store }) => {
					const document = makeDocument({ name: 'north', path: path as string })
					await expectRejectsWith({
						action: store.registerDocument(document),
						key: 'DOCUMENT_PATH_INVALID',
						meta: { path },
					})
					expect(await store.getDocuments()).toEqual([])
				},
			},
		]),
	),
	'a name that is not a string, the path ending with it → DOCUMENT_PATH_INVALID, nothing registered':
		{
			act: async ({ store }) => {
				await expectRejectsWith({
					action: store.registerDocument(
						makeDocument({ name: 7 as unknown as string, path: 'substations/7.xml' }),
					),
					key: 'DOCUMENT_PATH_INVALID',
				})
				expect(await store.getDocuments()).toEqual([])
			},
		},
	'a second document at a held path → DOCUMENT_PATH_TAKEN by the first, nothing registered': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await expectRejectsWith({
				action: store.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' })),
				key: 'DOCUMENT_PATH_TAKEN',
				meta: { documentId: 'b', path: 'substations/north.xml', takenBy: 'a' },
			})
			expect(await registeredIds(store)).toEqual(['a'])
		},
	},
	'a path under a held file, and a file over a held path → DOCUMENT_PATH_TAKEN, nothing registered':
		{
			act: async ({ store }) => {
				await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
				await store.registerDocument(documentAt({ id: 'b', path: 'lines/feeder.xml/inner.xml' }))
				await expectRejectsWith({
					action: store.registerDocument(
						documentAt({ id: 'c', path: 'substations/north.xml/x.xml' }),
					),
					key: 'DOCUMENT_PATH_TAKEN',
					meta: { documentId: 'c', path: 'substations/north.xml/x.xml', takenBy: 'a' },
				})
				await expectRejectsWith({
					action: store.registerDocument(documentAt({ id: 'd', path: 'lines/feeder.xml' })),
					key: 'DOCUMENT_PATH_TAKEN',
					meta: { documentId: 'd', path: 'lines/feeder.xml', takenBy: 'b' },
				})
				expect(await registeredIds(store)).toEqual(['a', 'b'])
			},
		},
	'two documents without a path, one name → both registered': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.registerDocument(makeDocument({ id: 'b' }))
			expect(await registeredIds(store)).toEqual(['a', 'b'])
		},
	},
	'a place held by a document still importing → DOCUMENT_PATH_TAKEN': {
		act: async ({ store }) => {
			await store.registerDocument(
				documentAt({ id: 'a', path: 'substations/north.xml', status: 'importing' }),
			)
			await expectRejectsWith({
				action: store.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' })),
				key: 'DOCUMENT_PATH_TAKEN',
			})
		},
	},
	'a place freed by a removal → registered again': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await store.removeDocument('a')
			await store.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' }))
			expect(await registeredIds(store)).toEqual(['b'])
		},
	},
	'a place held by an import left unfinished → free once the store opens again': {
		act: async ({ store, reopen }) => {
			await store.registerDocument(
				documentAt({ id: 'left', path: 'substations/north.xml', status: 'importing' }),
			)
			const reopened = await reopen()
			await reopened.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' }))
			expect(await registeredIds(reopened)).toEqual(['b'])
		},
	},
	'an id taken and a path taken → STORE_DUPLICATE_ID first': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await expectRejectsWith({
				action: store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' })),
				key: 'STORE_DUPLICATE_ID',
			})
		},
	},
	'metadata that is not JSON and an invalid path → STORE_VALUE_NOT_JSON first': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.registerDocument(
					makeDocument({ path: '/north.xml', metadata: { at: new Date(0) } }),
				),
				key: 'STORE_VALUE_NOT_JSON',
			})
		},
	},
	'an invalid path that also clashes → DOCUMENT_PATH_INVALID first': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await expectRejectsWith({
				action: store.registerDocument(
					makeDocument({ id: 'b', name: 'south', path: 'substations/north.xml' }),
				),
				key: 'DOCUMENT_PATH_INVALID',
			})
		},
	},
	'two connections registering one id at once → one registered, the other STORE_DUPLICATE_ID': {
		needs: ['second-connection'],
		act: async ({ store, connect }) => {
			const other = await connect()
			const outcomes = await Promise.allSettled([
				store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' })),
				other.registerDocument(documentAt({ id: 'a', path: 'lines/feeder.xml' })),
			])
			const refused = outcomes.filter((outcome) => outcome.status === 'rejected')
			expect(refused).toHaveLength(1)
			expect(toDialecteError((refused[0] as PromiseRejectedResult).reason)?.key).toBe(
				'STORE_DUPLICATE_ID',
			)
			expect(await registeredIds(store)).toEqual(['a'])
			expect(await registeredIds(other)).toEqual(['a'])
		},
	},
	'two connections registering one path at once → one registered, the other DOCUMENT_PATH_TAKEN': {
		needs: ['second-connection'],
		act: async ({ store, connect }) => {
			const other = await connect()
			const outcomes = await Promise.allSettled([
				store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' })),
				other.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' })),
			])
			const refused = outcomes.filter((outcome) => outcome.status === 'rejected')
			expect(refused).toHaveLength(1)
			expect(toDialecteError((refused[0] as PromiseRejectedResult).reason)?.key).toBe(
				'DOCUMENT_PATH_TAKEN',
			)
			expect(await store.getDocuments()).toHaveLength(1)
			expect(await other.getDocuments()).toHaveLength(1)
		},
	},
	'a path registered through one connection → refused through another': {
		needs: ['second-connection'],
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await expectRejectsWith({
				action: other.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' })),
				key: 'DOCUMENT_PATH_TAKEN',
				meta: { documentId: 'b', path: 'substations/north.xml', takenBy: 'a' },
			})
		},
	},
}

/** Documents `a` at `substations/north.xml` and `b` at `substations/south.xml`. */
async function seedTwoPlaced(store: Store): Promise<void> {
	await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
	await store.registerDocument(documentAt({ id: 'b', path: 'substations/south.xml' }))
}

/** The update is refused with that key, and the documents read as they did before it. */
async function expectUpdateRefused(params: {
	store: Store
	documentId: string
	updates: Parameters<Store['updateDocument']>[1]
	key: 'DOCUMENT_PATH_INVALID' | 'DOCUMENT_PATH_TAKEN'
	meta?: Record<string, unknown>
}): Promise<void> {
	const { store, documentId, updates, key, meta } = params
	const before = await store.getDocuments()
	await expectRejectsWith({ action: store.updateDocument(documentId, updates), key, meta })
	expect(await store.getDocuments()).toEqual(before)
}

const updating: StoreContractCases = {
	'a path → moved and renamed: the path and the name follow, the extension kept; after a reopen too':
		{
			act: async ({ store, reopen }) => {
				await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
				await store.updateDocument('a', { path: 'lines/feeder.xml' })
				const moved = documentAt({ id: 'a', path: 'lines/feeder.xml' })
				expect(await store.getDocument('a')).toEqual(moved)
				const reopened = await reopen()
				expect(await reopened.getDocument('a')).toEqual(moved)
			},
		},
	'a path on a document without one → it takes it, its name the file name': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.updateDocument('a', { path: 'substations/north.xml' })
			expect(await store.getDocument('a')).toEqual(
				documentAt({ id: 'a', path: 'substations/north.xml' }),
			)
		},
	},
	'a name on a document with a path → the file name in the path follows, its folders kept': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await store.updateDocument('a', { name: 'centre' })
			expect(await store.getDocument('a')).toEqual(
				documentAt({ id: 'a', path: 'substations/centre.xml' }),
			)
		},
	},
	'metadata or status on a document with a path → the path kept': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await store.updateDocument('a', { metadata: { origin: 'test' }, status: 'importing' })
			expect(await store.getDocument('a')).toEqual(
				documentAt({
					id: 'a',
					path: 'substations/north.xml',
					metadata: { origin: 'test' },
					status: 'importing',
				}),
			)
		},
	},
	'its own path → no change, no refusal': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			const before = await store.getDocuments()
			await store.updateDocument('a', { path: 'substations/north.xml' })
			expect(await store.getDocuments()).toEqual(before)
		},
	},
	'a name onto a sibling’s file name → DOCUMENT_PATH_TAKEN, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { name: 'south' },
				key: 'DOCUMENT_PATH_TAKEN',
				meta: { documentId: 'a', path: 'substations/south.xml', takenBy: 'b' },
			})
		},
	},
	'a path another document holds, or a folder of it → DOCUMENT_PATH_TAKEN, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { path: 'substations/south.xml' },
				key: 'DOCUMENT_PATH_TAKEN',
				meta: { documentId: 'a', path: 'substations/south.xml', takenBy: 'b' },
			})
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { path: 'substations/south.xml/north.xml' },
				key: 'DOCUMENT_PATH_TAKEN',
			})
		},
	},
	'a path of another extension → DOCUMENT_PATH_INVALID, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { path: 'substations/north.scd' },
				key: 'DOCUMENT_PATH_INVALID',
			})
		},
	},
	'a name and a path that disagree → DOCUMENT_PATH_INVALID, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { name: 'east', path: 'substations/west.xml' },
				key: 'DOCUMENT_PATH_INVALID',
			})
		},
	},
	'a name holding a separator on a document with a path → DOCUMENT_PATH_INVALID, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { name: 'x/east' },
				key: 'DOCUMENT_PATH_INVALID',
			})
		},
	},
	'a name that is not a string on a document with a path → DOCUMENT_PATH_INVALID, nothing changed':
		{
			act: async ({ store }) => {
				await seedTwoPlaced(store)
				await expectUpdateRefused({
					store,
					documentId: 'a',
					updates: { name: null as unknown as string },
					key: 'DOCUMENT_PATH_INVALID',
				})
			},
		},
	'a path given as null → DOCUMENT_PATH_INVALID, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await expectUpdateRefused({
				store,
				documentId: 'a',
				updates: { path: null as unknown as string },
				key: 'DOCUMENT_PATH_INVALID',
			})
		},
	},
	'a place freed by a move → another document takes it': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			await store.updateDocument('a', { path: 'lines/north.xml' })
			await store.registerDocument(documentAt({ id: 'c', path: 'substations/north.xml' }))
			expect(await registeredIds(store)).toEqual(['a', 'b', 'c'])
		},
	},
	'keys an update does not take (id, extension, configKey, createdAt, writeId) → ignored, the document as it was':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument({ id: 'a', writeId: 'w-a' }))
				await store.registerDocument(makeDocument({ id: 'b' }))
				const before = await store.getDocuments()
				await store.updateDocument('a', {
					id: 'zz',
					extension: '.other',
					configKey: 'other',
					createdAt: 7,
					writeId: 'w-other',
				} as DocumentUpdates)
				expect(await store.getDocuments()).toEqual(before)
			},
		},
	'metadata that is not JSON and an invalid path → STORE_VALUE_NOT_JSON first, nothing changed': {
		act: async ({ store }) => {
			await seedTwoPlaced(store)
			const before = await store.getDocuments()
			await expectRejectsWith({
				action: store.updateDocument('a', { path: '/north.xml', metadata: { at: new Date(0) } }),
				key: 'STORE_VALUE_NOT_JSON',
			})
			expect(await store.getDocuments()).toEqual(before)
		},
	},
	'an invalid path for a document not registered → left alone, no refusal': {
		act: async ({ store }) => {
			await store.updateDocument('nope', { path: '/north.xml' })
			expect(await store.getDocuments()).toEqual([])
		},
	},
	'a path for a document not registered → left alone, nothing registered': {
		act: async ({ store }) => {
			await store.updateDocument('nope', { path: 'substations/north.xml' })
			expect(await store.getDocuments()).toEqual([])
		},
	},
	'a place taken by an update through one connection → refused through another; the place it left is free there':
		{
			needs: ['second-connection'],
			act: async ({ store, connect }) => {
				const other = await connect()
				await seedTwoPlaced(store)
				await store.updateDocument('a', { path: 'lines/north.xml' })
				await expectRejectsWith({
					action: other.registerDocument(documentAt({ id: 'c', path: 'lines/north.xml' })),
					key: 'DOCUMENT_PATH_TAKEN',
					meta: { documentId: 'c', path: 'lines/north.xml', takenBy: 'a' },
				})
				await other.registerDocument(documentAt({ id: 'd', path: 'substations/north.xml' }))
				await expectRejectsWith({
					action: other.updateDocument('b', { path: 'lines/north.xml' }),
					key: 'DOCUMENT_PATH_TAKEN',
				})
				expect(await registeredIds(other)).toEqual(['a', 'b', 'd'])
			},
		},
}

/** An import of a file named `plant.xml` given `path`, its write id `w-placed`. */
function importAt(params: { store: Store; path: string }): ReturnType<Store['importFile']> {
	const { store, path } = params
	return store.importFile({
		file: contractFile({ body: sessionRecords(2), name: 'plant.xml' }),
		options: { path },
		writeId: 'w-placed',
	})
}

/** The import was refused with that key: nothing of it registered, its write not applied. */
async function expectImportRefused(params: {
	store: Store
	path: string
	key: 'DOCUMENT_PATH_INVALID' | 'DOCUMENT_PATH_TAKEN'
	kept?: string[]
}): Promise<void> {
	const { store, path, key, kept = [] } = params
	await expectRejectsWith({ action: importAt({ store, path }), key })
	expect(await registeredIds(store)).toEqual(kept)
	expect(await store.getWriteOutcome({ writeId: 'w-placed' })).toBe('not-applied')
}

const importingAtAPath: StoreContractCases = {
	'an import given a path → the document carries it, its name and extension the path’s file name’s, not the file’s':
		{
			act: async ({ store }) => {
				const { record } = await importAt({ store, path: 'substations/north.xml' })
				expect(record).toMatchObject({
					path: 'substations/north.xml',
					name: 'north',
					extension: '.xml',
				})
				expect(await store.getDocument(record.id)).toEqual(record)
				expect(await store.getWriteOutcome({ writeId: 'w-placed' })).toBe('applied')
			},
		},
	'an import given a path of an extension its config does not read → DOCUMENT_PATH_INVALID, nothing registered':
		{
			act: async ({ store }) => {
				await expectImportRefused({
					store,
					path: 'substations/north.scd',
					key: 'DOCUMENT_PATH_INVALID',
				})
			},
		},
	'an import given a path with no extension → DOCUMENT_PATH_INVALID, nothing registered': {
		act: async ({ store }) => {
			await expectImportRefused({ store, path: 'substations/north', key: 'DOCUMENT_PATH_INVALID' })
		},
	},
	'an import given a path breaking a rule → DOCUMENT_PATH_INVALID, nothing registered': {
		act: async ({ store }) => {
			await expectImportRefused({ store, path: '/north.xml', key: 'DOCUMENT_PATH_INVALID' })
		},
	},
	'an import at a held place → DOCUMENT_PATH_TAKEN, nothing of the file remains': {
		act: async ({ store }) => {
			await store.registerDocument(documentAt({ id: 'a', path: 'substations/north.xml' }))
			await expectImportRefused({
				store,
				path: 'substations/north.xml',
				key: 'DOCUMENT_PATH_TAKEN',
				kept: ['a'],
			})
		},
	},
	'an import that fails → its place free again': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.importFile({
					file: contractFile({ body: `<B aB="B0" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>` }),
					options: { path: 'substations/north.xml' },
				}),
				key: 'IMPORT_FAILED',
			})
			await store.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' }))
			expect(await registeredIds(store)).toEqual(['b'])
		},
	},
	'a place held by a running import → a registration there is refused': {
		act: async ({ store }) => {
			const hold = holdContractImport()
			const importing = store.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${CONTRACT_SESSION_HOLD_VALUE}"/>` }),
				options: { path: 'substations/north.xml' },
			})
			try {
				await untilHeld({ hold, importing })
				await expectRejectsWith({
					action: store.registerDocument(documentAt({ id: 'b', path: 'substations/north.xml' })),
					key: 'DOCUMENT_PATH_TAKEN',
				})
			} finally {
				hold.release()
				await importing.catch(() => undefined)
			}
			expect((await importing).record.path).toBe('substations/north.xml')
		},
	},
}

const exportingAtAPath: StoreContractCases = {
	'a document imported at a path → its export is named after the path’s file name': {
		act: async ({ store }) => {
			const { record } = await importAt({ store, path: 'substations/north.xml' })
			expect((await store.exportFile({ documentId: record.id })).filename).toBe('north.xml')
		},
	},
	'renamed by an update → the next export takes the new file name': {
		act: async ({ store }) => {
			const { record } = await importAt({ store, path: 'substations/north.xml' })
			await store.updateDocument(record.id, { path: 'lines/feeder.xml' })
			expect((await store.exportFile({ documentId: record.id })).filename).toBe('feeder.xml')
		},
	},
}

/** What every store answers about a document's place in the project; merged into the store contract. */
export const STORE_PATH_CONTRACT: StoreContractGroups = {
	'a document path: registering': registering,
	'a document path: moving and renaming': updating,
	'a document path: importing at a path': needing({ needs: ['import'], cases: importingAtAPath }),
	'a document path: exporting': needing({ needs: ['import', 'export'], cases: exportingAtAPath }),
}
