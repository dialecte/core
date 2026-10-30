import { contractFile, makeRecord as makeContractRecord } from '../contract/store-contract.fixtures'
import {
	createContractRuntime,
	holdContractImport,
	untilHeld,
} from '../contract/store-contract.import-session'
import { recordTableName, TABLE_META } from '../store.constants'
import { DexieStore, buildDexieSchema } from './dexie-store'
import { DESTROY_LOCK_WAIT_MS, OPEN_LOCK_PREFIX, VERSION_KEY_PREFIX } from './dexie-store.constants'

import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { toDialecteError } from '@/errors'
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
		// the open's sweep reads the registry through the store's own read, not the public one
		const sweeping = other as unknown as { getDocumentsUnguarded: () => Promise<DocumentRecord[]> }
		const listDocuments = sweeping.getDocumentsUnguarded.bind(other)
		let gated = false
		sweeping.getDocumentsUnguarded = async () => {
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

/** The key of what a destroy threw, or `undefined` once it destroyed. */
async function destroyOutcome(params: { store: DexieStore }): Promise<string | undefined> {
	return params.store.destroy().then(
		function destroyed() {
			return undefined
		},
		function refused(thrown: unknown) {
			return toDialecteError(thrown)?.key
		},
	)
}

/** Whether `work` settles within `ms`: a hang fails the case with its own message, not the test's timeout. */
async function settlesWithin(params: { work: Promise<unknown>; ms: number }): Promise<boolean> {
	const settled = params.work.then(
		() => true,
		() => true,
	)
	const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), params.ms))
	return Promise.race([settled, timedOut])
}

/** Whether the open lock of the name is free now, as a destroy of another tab asks for it. */
async function openLockFree(params: { name: string }): Promise<boolean> {
	return navigator.locks.request(
		`${OPEN_LOCK_PREFIX}${params.name}`,
		{ mode: 'exclusive', ifAvailable: true },
		function isGranted(lock) {
			return lock !== null
		},
	)
}

describe('DexieStore - a destroy while another connection has the project open', () => {
	it('a destroy refused, its store closed while the destroy waited → no hold taken back: the other closed, a destroy goes on', async () => {
		const name = uniqueName()
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		await first.open()
		await second.open()

		const refusing = destroyOutcome({ store: first })
		// within the moment the destroy waits for the open lock alone
		await new Promise((resolve) => setTimeout(resolve, 100))
		first.close()
		expect(await refusing).toBe('PROJECT_OPEN_ELSEWHERE')
		second.close()

		expect(await destroyOutcome({ store: new DexieStore(name) })).toBeUndefined()
	})

	it('a connection closed just before → the destroy waits for its hold to go: destroyed', async () => {
		const name = uniqueName()
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		await first.open()
		await second.open()

		second.close()

		expect(await destroyOutcome({ store: first })).toBeUndefined()
	})

	it('a read through a store while its own destroy waits for a connection closed just before → the destroy goes on, the read answers after it', async () => {
		const name = uniqueName()
		const store = new DexieStore(name)
		const other = new DexieStore(name)
		await store.open()
		await other.open()
		await store.registerDocument(makeFile({ id: 'file-1' }))
		other.close()

		const destroying = destroyOutcome({ store })
		await new Promise((resolve) => setTimeout(resolve, 0))
		const reading = store.getDocuments()

		expect(await destroying).toBeUndefined()
		expect(await reading).toEqual([])
		store.close()
		await store.destroy()
	})

	it('a store closed while its operation waits for the open lock → that operation refused STORE_CLOSED', async () => {
		const name = uniqueName()
		let letGo: () => void = () => {}
		await new Promise<void>(function holdAlone(held) {
			void navigator.locks.request(`${OPEN_LOCK_PREFIX}${name}`, { mode: 'exclusive' }, () => {
				held()
				return new Promise<void>((release) => {
					letGo = release
				})
			})
		})
		const store = new DexieStore(name)
		const reading = store.getDocuments().then(
			() => undefined,
			(thrown: unknown) => toDialecteError(thrown)?.key,
		)
		await new Promise((resolve) => setTimeout(resolve, 50))
		store.close()
		letGo()

		expect(await reading).toBe('STORE_CLOSED')
	})

	it('a store never opened, its destroy refused → it holds nothing: the other closed, a destroy goes on', async () => {
		const name = uniqueName()
		const open = new DexieStore(name)
		await open.open()
		const never = new DexieStore(name)

		expect(await destroyOutcome({ store: never })).toBe('PROJECT_OPEN_ELSEWHERE')
		open.close()

		expect(await destroyOutcome({ store: new DexieStore(name) })).toBeUndefined()
	})

	it('a store closed while its open waits for the open lock → its hold let go once granted: a destroy goes on', async () => {
		const name = uniqueName()
		let letGo: () => void = () => {}
		await new Promise<void>(function holdAlone(held) {
			void navigator.locks.request(`${OPEN_LOCK_PREFIX}${name}`, { mode: 'exclusive' }, () => {
				held()
				return new Promise<void>((release) => {
					letGo = release
				})
			})
		})
		const store = new DexieStore(name)
		const opening = store.open().catch(() => undefined)
		await new Promise((resolve) => setTimeout(resolve, 50))
		store.close()
		letGo()
		await opening

		expect(await destroyOutcome({ store: new DexieStore(name) })).toBeUndefined()
	})

	it('a store closed with an import running → it holds the open lock until the import ends: a destroy of another tab refused meanwhile', async () => {
		const name = uniqueName()
		const store = new DexieStore(name, { runtime: createContractRuntime() })
		await store.open()
		const hold = holdContractImport()
		const importing = store.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		try {
			await untilHeld({ hold, importing })
			store.close()
			// a hold let go at close() would be gone by then
			await new Promise((resolve) => setTimeout(resolve, 100))

			expect(await openLockFree({ name })).toBe(false)
			hold.release()
			await importing
			// let go once the import has ended
			await vi.waitFor(async () => {
				expect(await openLockFree({ name })).toBe(true)
			})
		} finally {
			hold.release()
			await importing.catch(() => undefined)
		}
	})

	it('a store closed with an import running, opened again → it holds the open lock once the import has ended', async () => {
		const name = uniqueName()
		const store = new DexieStore(name, { runtime: createContractRuntime() })
		await store.open()
		const hold = holdContractImport()
		const importing = store.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		try {
			await untilHeld({ hold, importing })
			store.close()
			const reopening = store.open()
			hold.release()
			await importing
			await reopening
			// the hold let go with the import would be gone by then
			await new Promise((resolve) => setTimeout(resolve, 100))

			expect(await openLockFree({ name })).toBe(false)
		} finally {
			hold.release()
			await importing.catch(() => undefined)
			store.close()
		}
	})

	it('a store closed with an import running, another store of the page destroys → the destroy waits for the import past its lock wait, then goes on', async () => {
		const name = uniqueName()
		const closing = new DexieStore(name, { runtime: createContractRuntime() })
		const other = new DexieStore(name)
		await closing.open()
		await other.open()
		const hold = holdContractImport()
		const importing = closing.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		try {
			await untilHeld({ hold, importing })
			closing.close()
			const destroying = destroyOutcome({ store: other })
			await new Promise((resolve) => setTimeout(resolve, DESTROY_LOCK_WAIT_MS + 100))
			hold.release()
			await importing

			expect(await destroying).toBeUndefined()
		} finally {
			hold.release()
			await importing.catch(() => undefined)
		}
	})

	it('a store destroyed while its open runs → the destroy waits for the open: both settle, the store destroyed', async () => {
		const name = uniqueName()
		const store = new DexieStore(name)
		const reloading = store as unknown as { reloadFromPersisted: () => Promise<void> }
		const reload = reloading.reloadFromPersisted.bind(store)
		let reached: () => void = () => {}
		const reloadReached = new Promise<void>((resolve) => {
			reached = resolve
		})
		let letReloadGo: () => void = () => {}
		const reloadHeld = new Promise<void>((resolve) => {
			letReloadGo = resolve
		})
		vi.spyOn(reloading, 'reloadFromPersisted').mockImplementationOnce(async () => {
			reached()
			await reloadHeld
			await reload()
		})
		const opening = store.open()
		await reloadReached
		const destroying = destroyOutcome({ store })
		letReloadGo()

		expect(await settlesWithin({ work: Promise.all([opening, destroying]), ms: 3_000 })).toBe(true)
		expect(await destroying).toBeUndefined()
		store.close()
	})

	it('a read waiting for its store’s own destroy, the store closed meanwhile → that read refused STORE_CLOSED, no hold left: another store’s destroy goes on', async () => {
		const name = uniqueName()
		const store = new DexieStore(name, { runtime: createContractRuntime() })
		await store.open()
		const hold = holdContractImport()
		const importing = store.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		try {
			await untilHeld({ hold, importing })
			// waits for the import: the read started meanwhile waits for it
			const destroying = destroyOutcome({ store })
			const reading = store.getDocuments().then(
				() => undefined,
				(thrown: unknown) => toDialecteError(thrown)?.key,
			)
			store.close()
			hold.release()
			await importing

			expect(await destroying).toBeUndefined()
			expect(await reading).toBe('STORE_CLOSED')
			expect(await destroyOutcome({ store: new DexieStore(name) })).toBeUndefined()
		} finally {
			hold.release()
			await importing.catch(() => undefined)
		}
	})

	it('a store opened twice at once, then closed → no hold left: a destroy goes on', async () => {
		const name = uniqueName()
		const store = new DexieStore(name)
		await Promise.all([store.open(), store.open()])
		store.close()

		expect(await destroyOutcome({ store: new DexieStore(name) })).toBeUndefined()
	})

	it('no Web Locks → the connections of the page counted: a destroy refused while another is open; that one closed with an import running → the destroy waits for it, then goes on', async () => {
		// the page's own `locks` shadowed, then removed: the browser's comes back
		Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
		try {
			const name = uniqueName()
			const first = new DexieStore(name)
			const second = new DexieStore(name, { runtime: createContractRuntime() })
			await first.open()
			await second.open()

			expect(await destroyOutcome({ store: first })).toBe('PROJECT_OPEN_ELSEWHERE')
			// closed with an import running: the destroy lets it complete first
			const hold = holdContractImport()
			const importing = second.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-held',
			})
			try {
				await untilHeld({ hold, importing })
				second.close()
				const destroying = destroyOutcome({ store: first })
				hold.release()
				await importing
				expect(await destroying).toBeUndefined()
			} finally {
				hold.release()
				await importing.catch(() => undefined)
			}
		} finally {
			delete (navigator as { locks?: unknown }).locks
		}
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
