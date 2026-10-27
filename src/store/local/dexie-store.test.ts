import { makeRecord as makeContractRecord } from '../contract/store-contract.fixtures'
import { recordTableName, TABLE_META } from '../store.constants'
import { DexieStore, buildDexieSchema } from './dexie-store'
import { VERSION_KEY_PREFIX } from './dexie-store.constants'

import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { RecordSchema } from '../store.types'
import type { DocumentRecord } from '@/project'
import type { AnyDialecteConfig } from '@/types'
import type { AnyRawRecord } from '@/types/records'

describe('buildDexieSchema', () => {
	it('builds minimal schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			indexes: ['tagName'],
			compoundIndexes: [],
			arrayIndexes: [],
		}
		expect(buildDexieSchema(schema)).toBe('id, tagName')
	})

	it('builds full SCL schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			indexes: ['tagName', 'parent.id', 'parent.tagName'],
			compoundIndexes: [['id', 'tagName']],
			arrayIndexes: ['children.id', 'children.tagName'],
		}
		expect(buildDexieSchema(schema)).toBe(
			'id, tagName, parent.id, parent.tagName, [id+tagName], *children.id, *children.tagName',
		)
	})

	it('builds auto-increment schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			autoIncrement: true,
			indexes: ['documentId'],
			compoundIndexes: [['documentId', 'sequenceNumber']],
			arrayIndexes: [],
		}
		expect(buildDexieSchema(schema)).toBe('++id, documentId, [documentId+sequenceNumber]')
	})
})

const DB_PREFIX = 'test-dexie-store'

function uniqueName() {
	return `${DB_PREFIX}-${crypto.randomUUID()}`
}

function makeFile(overrides?: Partial<DocumentRecord>): DocumentRecord {
	return {
		id: crypto.randomUUID(),
		name: 'test-file',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
		status: 'ready',
		...overrides,
	}
}

function makeRecord(): AnyRawRecord {
	return makeContractRecord({ id: crypto.randomUUID() })
}

// What any store must do is in src/store/contract; here is what is DexieStore's own.

describe('DexieStore', () => {
	let store: DexieStore

	beforeEach(async () => {
		store = new DexieStore(uniqueName())
		await store.open()
	})

	afterEach(async () => {
		await store.destroy()
	})

	it('destroy removes the database', async () => {
		const name = store.name
		await store.destroy()
		// Verify DB is gone by trying to open it fresh
		const check = new Dexie(name)
		check.version(1).stores({ _test: 'id' })
		await check.open()
		expect(check.tables.map((t) => t.name)).not.toContain('_documents')
		check.close()
		await Dexie.delete(name)
	})

	it('accepts custom RecordSchema from dialecte config', async () => {
		const customStore = new DexieStore(uniqueName(), {
			recordSchema: {
				primaryKey: 'id',
				indexes: ['tagName', 'parent.id', 'parent.tagName'],
				compoundIndexes: [['id', 'tagName']],
				arrayIndexes: ['children.id', 'children.tagName'],
			},
		})
		await customStore.open()
		const file = makeFile()
		await customStore.registerDocument(file)
		const rec = makeRecord()
		await customStore.bulkWrite(file.id, { creates: [rec] })
		const result = await customStore.get(rec.id, file.id)
		expect(result?.id).toBe(rec.id)
		await customStore.destroy()
	})
})

describe('DexieStore cross-instance reconciliation', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const fn of cleanups) {
			try {
				await fn()
			} catch {
				// best-effort cleanup
			}
		}
		cleanups.length = 0
	})

	// Two connections to the same database name, both open concurrently, model
	// the iframe/shell cross-realm setup: realm B is already open when realm A
	// imports a new document (schema bump adds the xel_<id> table).
	async function openPair(): Promise<{ a: DexieStore; b: DexieStore; name: string }> {
		const name = uniqueName()
		const a = new DexieStore(name)
		const b = new DexieStore(name)
		await a.open()
		await b.open()
		cleanups.push(async () => a.close())
		cleanups.push(async () => b.destroy())
		return { a, b, name }
	}

	it('self-heals reads when another open connection imports a document', async () => {
		const { a, b } = await openPair()

		const file = makeFile()
		const rec = makeRecord()
		await a.registerDocument(file)
		await a.bulkWrite(file.id, { creates: [rec] })

		// Without the self-heal, b's Dexie connection still lacks xel_<id> and reads the
		// document as absent (no records) here.
		const records = await b.getByDocumentId(file.id)
		expect(records).toHaveLength(1)
		expect(records[0].id).toBe(rec.id)
	})

	it('reconcile() adopts the schema of a foreign import', async () => {
		const { a, b } = await openPair()

		const file = makeFile()
		await a.registerDocument(file)

		expect(await b.isDocumentReadable(file.id)).toBe(false)

		await b.reconcile()

		expect(await b.isDocumentReadable(file.id)).toBe(true)
		const docs = await b.getDocuments()
		expect(docs.map((d) => d.id)).toContain(file.id)
	})

	it('isDocumentReadable is false for an unknown document', async () => {
		const { b } = await openPair()
		expect(await b.isDocumentReadable(crypto.randomUUID())).toBe(false)
	})
})

describe('DexieStore - an import running in another connection', () => {
	// a connection opening while another one imports is the store contract's; here the race with
	// the registry read is IndexedDB's own
	const NS = TEST_DIALECTE_CONFIG.namespaces.default.uri

	it('a connection that lists the registry while another one registers its import leaves that import running', async () => {
		const name = uniqueName()
		let markOtherOpened: () => void = () => {}
		const otherOpened = new Promise<void>((resolve) => {
			markOtherOpened = resolve
		})
		let documentRegistered: () => void = () => {}
		const registered = new Promise<void>((resolve) => {
			documentRegistered = resolve
		})
		const importer = new DexieStore(name, {
			runtime: {
				configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
				defaultConfigKey: 'default',
				// the session is created once the document is registered; it ends once the second
				// connection has opened, so the document is `importing` all along that open
				hooks: {
					createImportSession: () => {
						documentRegistered()
						return {
							afterImport: async () => {
								await otherOpened
								return {}
							},
						}
					},
				},
			},
		})
		await importer.open()
		const file = new File([`<Root xmlns="${NS}"><A/><B aB="1"/></Root>`], 'one.xml', {
			type: 'text/xml',
		})

		// the second connection starts opening; its first registry read waits until the first
		// connection, which starts importing only then, has taken its lock and registered the document
		const other = new DexieStore(name)
		let readingStarted: () => void = () => {}
		const reading = new Promise<void>((resolve) => {
			readingStarted = resolve
		})
		const listDocuments = other.getDocuments.bind(other)
		let gated = false
		other.getDocuments = async () => {
			if (!gated) {
				gated = true
				readingStarted()
				await registered
			}
			return listDocuments()
		}
		const opening = other.open()
		await reading
		const importing = importer.importFile({ file, writeId: 'w-concurrent' })
		await opening
		markOtherOpened()

		const result = await importing
		expect(await other.getWriteOutcome({ writeId: 'w-concurrent' })).toBe('applied')
		// a fresh connection reads it whole (the one opened mid-upgrade keeps its old schema: an
		// IndexedDB-store limit of its own, not the import's)
		const fresh = new DexieStore(name)
		await fresh.open()
		expect(await fresh.getByDocumentId(result.record.id)).toHaveLength(3)
		fresh.close()
		other.close()
		await importer.destroy()
	})
})

describe('DexieStore - the connection of a closed store', () => {
	it('a commit running when the store is closed → the connection stays open until it ends, then closes', async () => {
		const store = new DexieStore(uniqueName())
		await store.open()
		await store.registerDocument(makeFile({ id: 'file-1' }))
		const committing = store.commit({
			documentId: 'file-1',
			creates: [makeContractRecord({ id: 'r1' })],
			updates: [],
			deletes: [],
			onProgress: () => {},
		})

		store.close()
		expect(store.getDatabaseInstance().isOpen()).toBe(true)
		await committing

		expect(store.getDatabaseInstance().isOpen()).toBe(false)
		await store.destroy()
	})

	it('a store closed while it opens → no connection left open behind the close', async () => {
		const store = new DexieStore(uniqueName())
		await store.open()
		await store.registerDocument(makeFile({ id: 'file-1' }))
		store.close()

		const opening = store.open()
		store.close()
		await opening.catch(() => undefined)

		expect(store.getDatabaseInstance().isOpen()).toBe(false)
		await store.destroy()
	})
})

describe('DexieStore - the write version of a document', () => {
	it('a document removed and registered again under its id -> its version goes on from the old value', async () => {
		const store = new DexieStore(`version-${crypto.randomUUID()}`)
		await store.open()
		try {
			const document: DocumentRecord = {
				id: 'again',
				name: 'again',
				extension: '.xml',
				configKey: 'default',
				createdAt: 0,
				status: 'ready',
			}
			async function versionOf(): Promise<number | undefined> {
				const row = await store
					.getDatabaseInstance()
					.table(TABLE_META)
					.get(`${VERSION_KEY_PREFIX}again`)
				return row?.value
			}
			await store.registerDocument(document)
			await store.bulkWrite('again', { creates: [makeContractRecord({ id: 'r1' })] })
			await store.bulkWrite('again', { creates: [makeContractRecord({ id: 'r2' })] })
			expect(await versionOf()).toBe(2)

			await store.removeDocument('again')
			await store.registerDocument(document)
			await store.bulkWrite('again', { creates: [makeContractRecord({ id: 'r1' })] })

			expect(await versionOf()).toBe(3)
		} finally {
			await store.destroy()
		}
	})
})

describe('DexieStore - a place taken while a registration ran', () => {
	it('two connections registering one id at once, then the refused one registering another → the first one’s records kept', async () => {
		const name = uniqueName()
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		await first.open()
		await second.open()
		try {
			const outcomes = await Promise.allSettled([
				first.registerDocument(makeFile({ id: 'x' })),
				second.registerDocument(makeFile({ id: 'x' })),
			])
			expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
			const [winner, refused] =
				outcomes[0].status === 'fulfilled' ? [first, second] : [second, first]
			await winner.bulkWrite('x', { creates: [makeContractRecord({ id: 'r1' })] })
			await refused.registerDocument(makeFile({ id: 'y' }))
			const fresh = new DexieStore(name)
			await fresh.open()
			try {
				expect((await fresh.getByDocumentId('x')).map((record) => record.id)).toEqual(['r1'])
			} finally {
				fresh.close()
			}
		} finally {
			second.close()
			await first.destroy()
		}
	})

	it('an id registered by another connection meanwhile, then a place refused → that document’s records kept', async () => {
		const name = uniqueName()
		const [placer, owner, refused] = [
			new DexieStore(name),
			new DexieStore(name),
			new DexieStore(name),
		]
		await Promise.all([placer.open(), owner.open(), refused.open()])
		// once the refused registration has passed its early checks, the other connections register the same id
		// (records written) and a document holding a folder of its place
		const checked = refused as unknown as { assertPlaceFree: (params: object) => Promise<void> }
		const earlyCheck = checked.assertPlaceFree.bind(refused)
		checked.assertPlaceFree = async function checkThenLetOthersWrite(params) {
			await earlyCheck(params)
			checked.assertPlaceFree = earlyCheck
			await owner.registerDocument(makeFile({ id: 'x', name: 'm', path: 'b/m.scd' }))
			await owner.bulkWrite('x', { creates: [makeContractRecord({ id: 'r1' })] })
			await placer.registerDocument(makeFile({ id: 'z', name: 'inner', path: 'z/n.scd/inner.scd' }))
		}
		// the tables a schema change of the refused connection drops: never those of an id another one holds
		const reopened = refused as unknown as {
			reopenWithNewSchema: (options?: { drop?: string }) => Promise<void>
		}
		const reopen = reopened.reopenWithNewSchema.bind(refused)
		const dropped: string[] = []
		reopened.reopenWithNewSchema = async function recordDrop(options) {
			if (options?.drop) dropped.push(options.drop)
			return reopen(options)
		}
		try {
			await expect(
				refused.registerDocument(makeFile({ id: 'x', name: 'n', path: 'z/n.scd' })),
			).rejects.toThrow()
			expect(dropped).toEqual([])
			const fresh = new DexieStore(name)
			await fresh.open()
			try {
				expect((await fresh.getDocument('x'))?.path).toBe('b/m.scd')
				expect((await fresh.getByDocumentId('x')).map((record) => record.id)).toEqual(['r1'])
			} finally {
				fresh.close()
			}
		} finally {
			owner.close()
			refused.close()
			await placer.destroy()
		}
	})

	it('two connections registering one path at once → the refused one leaves no table behind', async () => {
		const name = uniqueName()
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		await first.open()
		await second.open()
		try {
			const outcomes = await Promise.allSettled([
				first.registerDocument(makeFile({ id: 'a', name: 'north', path: 'subs/north.scd' })),
				second.registerDocument(makeFile({ id: 'b', name: 'north', path: 'subs/north.scd' })),
			])
			const refusedId = outcomes[0].status === 'rejected' ? 'a' : 'b'
			expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
			const check = new Dexie(name)
			await check.open()
			try {
				expect(check.tables.map((table) => table.name)).not.toContain(recordTableName(refusedId))
			} finally {
				check.close()
			}
		} finally {
			second.close()
			await first.destroy()
		}
	})
})
