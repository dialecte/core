import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	sessionRecords,
	SMALL_BATCHES,
} from '../../contract/store-contract.fixtures'
import {
	createContractRuntime,
	holdContractImport,
	untilHeld,
} from '../../contract/store-contract.import-session'
import { loadSqlite } from '../load-sqlite'
import { deviceCacheMiB, reportedDeviceMemoryGiB } from './device-cache'
import { RECORD_INDEXES, ROWS_PER_BIND } from './engine.constants'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE, DIALECTE_DEV_NAMESPACE } from '@/helpers/constant'
import { IMPORT_PROGRESS_INTERVAL_MS } from '@/store/import-progress/import-progress.constants'
import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { ContractImportHold } from '../../contract/store-contract.types'
import type { SqliteEngine, SqliteEngineOptions } from './engine.types'
import type { PerfSpan } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { ImportProgress } from '@/store/store.types'
import type { AnyRawRecord, RecordPatch } from '@/types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []
/** The holds a case took, released after it: an import never waits past its case. */
const holds: (() => void)[] = []

afterEach(() => {
	vi.restoreAllMocks()
	for (const release of holds.splice(0)) release()
	for (const db of opened.splice(0)) db.close()
})

/** An engine on a file of its own, importing with the contract's runtime unless another is given. */
async function startImportEngine(
	params: { options?: Partial<SqliteEngineOptions>; runtime?: StoreRuntime } = {},
): Promise<{ engine: SqliteEngine; db: Database; keeper: Database }> {
	const { options, runtime = createContractRuntime() } = params
	const file = await openMemoryFile({ opened })
	const db = file.connect()
	const engine = await startEngine({ db, options, runtime })
	return { engine, db, keeper: file.keeper }
}

/** The indexes of the record table of the document the import of `writeId` registered, read on the engine's connection. */
function indexesOfImport(params: { db: Database; writeId: string }): string[] {
	const { db, writeId } = params
	const seq = db.selectValue(`SELECT seq FROM ${TABLE_DOCUMENTS} WHERE writeId = ?`, [writeId])
	return db
		.selectValues(
			"SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? ORDER BY name",
			[`${TABLE_RECORD_PREFIX}${seq}`],
		)
		.map(String)
}

/**
 * How many spans named `inner` stopped within the span named `outer`: a perf keeps its spans in the
 * order they stop, so the inner spans of a span come right before it (the clock plays no part); the spans of the
 * phases the import tells around each index build (`import::phase.indexing`) stop among them and are passed over.
 */
function spansWithin(params: { spans: PerfSpan[]; outer: string; inner: string }): number {
	const { spans, outer, inner } = params
	const named = spans.filter((span) => !span.name.startsWith('import::phase.'))
	const end = named.findIndex((span) => span.name === outer)
	if (end === -1) return 0
	let start = end
	while (start > 0 && named[start - 1]!.name === inner) start -= 1
	return end - start
}

/** The contract's runtime with a session that, after the parse, waits for `released` and then creates `creates`. */
function runtimeCreatingAfterHold(params: {
	reached: () => void
	released: Promise<void>
	creates: AnyRawRecord[]
}): StoreRuntime {
	const { reached, released, creates } = params
	return {
		...createContractRuntime(),
		hooks: {
			createImportSession: function createHeldSession() {
				return {
					afterImport: async function createAfterRelease() {
						reached()
						await released
						return { creates }
					},
				}
			},
		},
	}
}

/** A file the contract's session holds at the end of its parse, until the case releases that hold. */
function heldFile(params: { hold: ContractImportHold }): File {
	return contractFile({ body: `<B aB="B0" bB="${params.hold.value}"/>` })
}

/** Start an import the session holds; answers it once it waits at its hold. */
async function startHeldImport(params: {
	engine: SqliteEngine
	writeId: string
	clientId: string
	onProgress?: (progress: ImportProgress) => void
}): Promise<{ importing: Promise<unknown>; release: () => void }> {
	const { engine, writeId, clientId, onProgress } = params
	const hold = holdContractImport()
	holds.push(hold.release)
	const importing = engine.importFile({ file: heldFile({ hold }), writeId, clientId }, onProgress)
	// a case that ends early must not leave an unhandled rejection behind
	importing.catch(() => undefined)
	await untilHeld({ hold, importing })
	return { importing, release: hold.release }
}

/** An instance of a class: a patch a store refuses whole. */
class PatchInstance {}

/** Below the device's cache: the import raises it, the steady one comes back after. */
const STEADY_CACHE_MIB = 8

type Pragmas = {
	synchronous: unknown
	journal: unknown
	cacheMiB: number
	inTransaction: boolean
}

/** Read at once, on the engine's connection: the probe runs inside the import's own call. */
function pragmasOf(params: { db: Database; sqlite3: Sqlite3Static }): Pragmas {
	const { db, sqlite3 } = params
	return {
		synchronous: db.selectValue('PRAGMA synchronous'),
		journal: db.selectValue('PRAGMA journal_mode'),
		// a negative cache_size is a size in KiB
		cacheMiB: -Number(db.selectValue('PRAGMA cache_size')) / 1024,
		inTransaction: sqlite3.capi.sqlite3_get_autocommit(db) === 0,
	}
}

/** The connection back to its durable settings: synchronous full, the steady cache, no transaction open. */
const DURABLE: Pragmas = {
	synchronous: 2,
	journal: 'truncate',
	cacheMiB: STEADY_CACHE_MIB,
	inTransaction: false,
}

describe('an engine importing files', () => {
	it('an engine started without a runtime → an import is refused IMPORT_FAILED, nothing registered', async () => {
		const file = await openMemoryFile({ opened })
		const engine = await startEngine({ db: file.connect() })
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: sessionRecords(1) }),
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'IMPORT_FAILED',
		})
		const documents = await engine.getDocuments()
		expect(documents).toEqual([])
		const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
		expect(writeOutcomeW1).toBe('not-applied')
	})

	describe('one import at a time', () => {
		it('a second import while one runs → it waits: running, nothing registered; both ready once the first is done', async () => {
			const { engine } = await startImportEngine()
			const first = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			const second = engine.importFile({
				file: contractFile({ body: sessionRecords(2) }),
				writeId: 'w-2',
				clientId: 'c-2',
			})
			const runningOutcomeW2 = await engine.getWriteOutcome({ writeId: 'w-2' })
			expect(runningOutcomeW2).toBe('running')
			const documentsMapped = await engine.getDocuments()
			expect(documentsMapped.map((document) => document.writeId)).toEqual(['w-1'])
			first.release()
			await first.importing
			const imported = await second
			expect(imported.record.status).toBe('ready')
			const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
			expect(writeOutcomeW1).toBe('applied')
			const writeOutcomeW2 = await engine.getWriteOutcome({ writeId: 'w-2' })
			expect(writeOutcomeW2).toBe('applied')
		})

		it('a second import of another client while one runs → it tells waiting at once, then storing once its turn comes; the first never waits', async () => {
			const { engine } = await startImportEngine()
			const firstHeard: ImportProgress[] = []
			const first = await startHeldImport({
				engine,
				writeId: 'w-1',
				clientId: 'c-1',
				onProgress: (progress) => firstHeard.push(progress),
			})
			const secondHeard: ImportProgress[] = []
			const second = engine.importFile(
				{ file: contractFile({ body: sessionRecords(2) }), writeId: 'w-2', clientId: 'c-2' },
				(progress) => secondHeard.push(progress),
			)
			await vi.waitFor(function waitingTold() {
				expect(secondHeard.map((progress) => progress.phase)).toEqual(['waiting'])
			})
			first.release()
			await first.importing
			await second
			expect(secondHeard[1]?.phase).toBe('storing')
			expect(firstHeard.some((progress) => progress.phase === 'waiting')).toBe(false)
		})

		it('an import asked, its outcome asked in the same turn → running: it will run', async () => {
			const { engine } = await startImportEngine()
			const importing = engine.importFile({
				file: contractFile({ body: sessionRecords(1) }),
				writeId: 'w-1',
				clientId: 'c-1',
			})
			const outcome = engine.getWriteOutcome({ writeId: 'w-1' })
			const outcomeSettled = await outcome
			expect(outcomeSettled).toBe('running')
			await importing
		})

		it('the imports of a client aborted for it → IMPORT_ABORTED, its document gone; another client’s waiting import then runs to ready', async () => {
			const { engine } = await startImportEngine()
			const first = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			const second = engine.importFile({
				file: contractFile({ body: sessionRecords(2) }),
				writeId: 'w-2',
				clientId: 'c-2',
			})
			engine.abortImportsOf({ clientId: 'c-1' })
			first.release()
			await expectRejectsWith({ action: first.importing, key: 'IMPORT_ABORTED' })
			const imported = await second
			const documentsMapped = await engine.getDocuments()
			expect(documentsMapped.map((document) => document.writeId)).toEqual(['w-2'])
			expect(imported.record.status).toBe('ready')
			const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
			expect(writeOutcomeW1).toBe('not-applied')
		})

		it('a waiting import aborted → IMPORT_ABORTED at once, while the running one still runs; nothing registered', async () => {
			const { engine } = await startImportEngine()
			const first = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			const second = engine.importFile({
				file: contractFile({ body: sessionRecords(2) }),
				writeId: 'w-2',
				clientId: 'c-2',
			})
			await engine.abortImport({ writeId: 'w-2' })
			await expectRejectsWith({ action: second, key: 'IMPORT_ABORTED' })
			const documentsMapped = await engine.getDocuments()
			expect(documentsMapped.map((document) => document.writeId)).toEqual(['w-1'])
			// the running import's window is still the one a write of another client settles
			await engine.registerDocument(makeDocument({ id: 'other' }))
			first.release()
			await first.importing
			const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
			expect(writeOutcomeW1).toBe('applied')
			const writeOutcomeW2 = await engine.getWriteOutcome({ writeId: 'w-2' })
			expect(writeOutcomeW2).toBe('not-applied')
		})
	})

	describe('the document table of an import', () => {
		it('while the import runs → its table has no index, its count the records stored; once ready → the id and the tag index', async () => {
			const { engine, db } = await startImportEngine()
			const held = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			expect(indexesOfImport({ db, writeId: 'w-1' })).toEqual([])
			const [importingDocument] = await engine.getDocuments()
			// the root and its one record, stored before the session's hold
			const countWhileImporting = await engine.count(importingDocument!.id)
			expect(countWhileImporting).toBe(2)
			held.release()
			await held.importing
			const countOnceReady = await engine.count(importingDocument!.id)
			expect(countOnceReady).toBe(2)
			expect(indexesOfImport({ db, writeId: 'w-1' })).toEqual([
				`${TABLE_RECORD_PREFIX}1_id`,
				`${TABLE_RECORD_PREFIX}1_tag`,
			])
		})

		type TestCase = { body: string; inWrites: number; inFinalize: number }
		const testCases: Record<string, TestCase> = {
			'a session that writes after the parse → the id index built for its writes, the tag index at the end':
				{
					body: sessionRecords(2),
					inWrites: 1,
					inFinalize: 1,
				},
			'a session that writes nothing → both indexes built at the end': {
				body: '<A/><C/>',
				inWrites: 0,
				inFinalize: 2,
			},
		}
		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const { engine } = await startImportEngine()
				const result = await engine.importFile({
					file: contractFile({ body: testCase.body }),
					writeId: 'w-1',
					clientId: 'c-1',
				})
				const spans = result.perf?.spans ?? []
				expect(spansWithin({ spans, outer: 'import::writes.after', inner: 'import::index' })).toBe(
					testCase.inWrites,
				)
				expect(spansWithin({ spans, outer: 'import::finalize', inner: 'import::index' })).toBe(
					testCase.inFinalize,
				)
			})
		}

		it('the importing document removed and its number taken by a new one → DOCUMENT_NOT_REGISTERED; the new document holds only its own records', async () => {
			let markReached: () => void = () => {}
			const reached = new Promise<void>((resolve) => {
				markReached = resolve
			})
			let release: () => void = () => {}
			const released = new Promise<void>((resolve) => {
				release = resolve
			})
			holds.push(release)
			const { engine } = await startImportEngine({
				runtime: runtimeCreatingAfterHold({
					reached: markReached,
					released,
					creates: [makeRecord({ id: 'x1' })],
				}),
			})
			const importing = engine.importFile({
				file: contractFile({ body: '<A/>' }),
				writeId: 'w-1',
				clientId: 'c-1',
			})
			importing.catch(() => undefined)
			await reached
			const [registered] = await engine.getDocuments()
			await engine.removeDocument(registered!.id)
			await engine.registerDocument(makeDocument({ id: 'other' }))
			await engine.bulkWrite('other', { creates: [makeRecord({ id: 'n1' })] })
			release()
			await expectRejectsWith({ action: importing, key: 'DOCUMENT_NOT_REGISTERED' })
			const recordsMappedOther = await engine.getByDocumentId('other')
			expect(recordsMappedOther.map((record) => record.id)).toEqual(['n1'])
			const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
			expect(writeOutcomeW1).toBe('not-applied')
		})
	})

	it('the importing document removed and registered again under its id → DOCUMENT_NOT_REGISTERED; the document registered again stays, with its records', async () => {
		let markReached: () => void = () => {}
		const reached = new Promise<void>((resolve) => {
			markReached = resolve
		})
		let release: () => void = () => {}
		const released = new Promise<void>((resolve) => {
			release = resolve
		})
		holds.push(release)
		const { engine } = await startImportEngine({
			runtime: runtimeCreatingAfterHold({
				reached: markReached,
				released,
				creates: [makeRecord({ id: 'x1' })],
			}),
		})
		const importing = engine.importFile({
			file: contractFile({ body: '<A/>' }),
			writeId: 'w-1',
			clientId: 'c-1',
		})
		importing.catch(() => undefined)
		await reached
		const [registered] = await engine.getDocuments()
		const documentId = registered!.id
		await engine.removeDocument(documentId)
		await engine.registerDocument(makeDocument({ id: documentId }))
		await engine.bulkWrite(documentId, { creates: [makeRecord({ id: 'n1' })] })
		release()
		await expectRejectsWith({ action: importing, key: 'DOCUMENT_NOT_REGISTERED' })
		const document = await engine.getDocument(documentId)
		expect(document).toEqual(makeDocument({ id: documentId }))
		const recordsMapped = await engine.getByDocumentId(documentId)
		expect(recordsMapped.map((record) => record.id)).toEqual(['n1'])
	})

	it('a session creating a record of an id the file gave → STORE_DUPLICATE_ID naming it, nothing left', async () => {
		const { engine } = await startImportEngine({
			runtime: runtimeCreatingAfterHold({
				reached: () => undefined,
				released: Promise.resolve(),
				creates: [makeRecord({ id: 'given' })],
			}),
		})
		const withId = `xmlns:${DIALECTE_DEV_NAMESPACE.prefix}="${DIALECTE_DEV_NAMESPACE.uri}" ${CUSTOM_RECORD_ID_ATTRIBUTE}="given"`
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: `<A ${withId}/>` }),
				options: { useCustomRecordsIds: true },
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_DUPLICATE_ID',
			meta: { documentId: expect.any(String), recordIds: ['given'] },
		})
		const documents = await engine.getDocuments()
		expect(documents).toEqual([])
	})

	it('a session creating a record of an id the file gave, holding a value that is not JSON → STORE_VALUE_NOT_JSON first, as every store answers; nothing left', async () => {
		function notJson() {}
		const { engine } = await startImportEngine({
			runtime: runtimeCreatingAfterHold({
				reached: () => undefined,
				released: Promise.resolve(),
				creates: [
					makeRecord({
						id: 'given',
						attributes: [{ name: 'a', value: notJson as unknown as string }],
					}),
				],
			}),
		})
		const withId = `xmlns:${DIALECTE_DEV_NAMESPACE.prefix}="${DIALECTE_DEV_NAMESPACE.uri}" ${CUSTOM_RECORD_ID_ATTRIBUTE}="given"`
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: `<A ${withId}/>` }),
				options: { useCustomRecordsIds: true },
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_VALUE_NOT_JSON',
		})
		const documents = await engine.getDocuments()
		expect(documents).toEqual([])
	})

	it('a session creating two records of one id (the file’s ids generated) → STORE_DUPLICATE_ID naming it, caught as the id index is built; nothing left', async () => {
		const { engine } = await startImportEngine({
			runtime: runtimeCreatingAfterHold({
				reached: () => undefined,
				released: Promise.resolve(),
				creates: [makeRecord({ id: 'twice' }), makeRecord({ id: 'twice' })],
			}),
		})
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: '<A/>' }),
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_DUPLICATE_ID',
			meta: { documentId: expect.any(String), recordIds: ['twice'] },
		})
		const documents = await engine.getDocuments()
		expect(documents).toEqual([])
	})

	it('a session patching more records than one bind holds, one patch not JSON past the first bind → STORE_VALUE_NOT_JSON naming its place among all the patches, nothing left', async () => {
		const patchCount = ROWS_PER_BIND + 500
		const refusedAt = ROWS_PER_BIND + 200
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function sessionPatchingMany() {
					return {
						afterImport: async function patchMany() {
							const updates: RecordPatch[] = Array.from({ length: patchCount }, (_, index) => ({
								recordId: `created-${index}`,
								value: 'v',
							}))
							updates[refusedAt] = Object.assign(new PatchInstance(), {
								recordId: `created-${refusedAt}`,
								value: 'v',
							})
							return {
								creates: Array.from({ length: patchCount }, (_, index) =>
									makeRecord({ id: `created-${index}` }),
								),
								updates,
							}
						},
					}
				},
			},
		}
		const { engine } = await startImportEngine({ runtime })
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: '<A/>' }),
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_VALUE_NOT_JSON',
			detail: new RegExp(`field "${refusedAt}"`),
		})
		const documents = await engine.getDocuments()
		expect(documents).toEqual([])
	})

	it('a session patching more records than one bind holds, a window of 0 ms → the engine yields while it checks the patches: a task queued meanwhile runs before the check ends', async () => {
		const patchCount = ROWS_PER_BIND + 500
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function sessionPatchingMany() {
					return {
						afterImport: async function patchMany() {
							const updates: RecordPatch[] = Array.from({ length: patchCount }, (_, index) => ({
								recordId: `created-${index}`,
								value: 'v',
							}))
							// the last patch is refused: the check ends there
							updates[patchCount - 1] = Object.assign(new PatchInstance(), {
								recordId: `created-${patchCount - 1}`,
							})
							return {
								creates: Array.from({ length: patchCount }, (_, index) =>
									makeRecord({ id: `created-${index}` }),
								),
								updates,
							}
						},
					}
				},
			},
		}
		const { engine } = await startImportEngine({ runtime, options: { importWindowMs: 0 } })
		const ran = { second: false, atRejection: false }
		let afterIndexing = false
		let queued = false
		const importing = engine.importFile(
			{ file: contractFile({ body: '<A/>' }), writeId: 'w-1', clientId: 'c-1' },
			function queueAfterTheIdIndex(progress: ImportProgress) {
				if (progress.phase === 'indexing') afterIndexing = true
				// once, after the first index build (the id index): the finalize builds come after the check
				if (!afterIndexing || progress.phase === 'indexing' || queued) return
				queued = true
				// the first task runs at the yield after the index build, the second one at the next yield
				setTimeout(() => setTimeout(() => (ran.second = true), 0), 0)
			},
		)
		const rejected = importing.catch(function noteTasks(thrown: unknown) {
			ran.atRejection = ran.second
			throw thrown
		})
		await expectRejectsWith({ action: rejected, key: 'STORE_VALUE_NOT_JSON' })
		expect(ran.atRejection).toBe(true)
	})

	it('a session patch of a record the document does not hold, the record created by another client while the engine yields after the check → the patch is not applied, as in one write', async () => {
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function sessionPatchingLater() {
					return {
						afterImport: async function patchAbsent() {
							return {
								updates: [{ recordId: 'later', value: Number.NaN as unknown as string }],
							}
						},
					}
				},
			},
		}
		const { engine } = await startImportEngine({ runtime, options: { importWindowMs: 0 } })
		let afterIndexing = false
		let queued = false
		const result = await engine.importFile(
			{ file: contractFile({ body: '<A/>' }), writeId: 'w-1', clientId: 'c-1' },
			function createLaterAfterTheCheck(progress: ImportProgress) {
				if (progress.phase === 'indexing') afterIndexing = true
				// once, after the first index build (the id index): the finalize builds come after the check
				if (!afterIndexing || progress.phase === 'indexing' || queued) return
				queued = true
				// the first task runs at the yield after the index build, the second one at the check's yield
				setTimeout(() => {
					setTimeout(() => {
						void engine.getDocuments().then(([importing]) =>
							engine.bulkWrite(importing!.id, {
								creates: [makeRecord({ id: 'later', value: 'given' })],
							}),
						)
					}, 0)
				}, 0)
			},
		)
		const later = await engine.get('later', result.record.id)
		expect(later?.value).toBe('given')
	})

	it('a file giving one of its own ids twice → refused STORE_DUPLICATE_ID at its batch, before the session’s after-import runs', async () => {
		let afterImportRan = false
		const { engine } = await startImportEngine({
			runtime: runtimeCreatingAfterHold({
				reached: () => (afterImportRan = true),
				released: Promise.resolve(),
				creates: [],
			}),
		})
		const withId = `xmlns:${DIALECTE_DEV_NAMESPACE.prefix}="${DIALECTE_DEV_NAMESPACE.uri}" ${CUSTOM_RECORD_ID_ATTRIBUTE}="twice"`
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: `<A ${withId}/><C ${withId}/>` }),
				options: { useCustomRecordsIds: true, chunkOptions: SMALL_BATCHES },
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_DUPLICATE_ID',
		})
		expect(afterImportRan).toBe(false)
	})

	it('with perf on → the engine’s own stages timed: the encoding and the commits tallied, each index build a span', async () => {
		const { engine } = await startImportEngine()
		const result = await engine.importFile({
			file: contractFile({ body: sessionRecords(2) }),
			options: { chunkOptions: SMALL_BATCHES },
			writeId: 'w-1',
			clientId: 'c-1',
		})
		expect(result.perf?.totals['import::encode']?.calls).toBeGreaterThan(1)
		expect(result.perf?.totals['import::commit']?.calls).toBeGreaterThan(0)
		expect(result.perf?.spans.filter((span) => span.name === 'import::index')).toHaveLength(2)
	})

	it('a session creating more records than two binds hold, the clock moving past the progress interval at each read → applying told per bind written, each index told by its name', async () => {
		const createCount = ROWS_PER_BIND * 2 + 1
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function sessionCreatingMany() {
					return {
						afterImport: async function createMany() {
							return {
								creates: Array.from({ length: createCount }, (_, index) =>
									makeRecord({ id: `created-${index}` }),
								),
							}
						},
					}
				},
			},
		}
		const { engine } = await startImportEngine({ runtime })
		// the realm's clock moved for the import only: every report past the interval is told; the engine's other
		// readers of it (its window's time, its yields) then commit and yield at each bind, which changes no write
		let clock = 0
		vi.spyOn(performance, 'now').mockImplementation(function movingClock() {
			clock += IMPORT_PROGRESS_INTERVAL_MS
			return clock
		})
		const heard: ImportProgress[] = []
		await engine.importFile(
			{ file: contractFile({ body: '<A/>' }), writeId: 'w-1', clientId: 'c-1' },
			(progress) => heard.push(progress),
		)
		const applied = heard.flatMap((progress) =>
			progress.phase === 'applying' ? [progress.done] : [],
		)
		expect([...new Set(applied)]).toEqual([0, ROWS_PER_BIND, ROWS_PER_BIND * 2, createCount])
		const indexes = heard.flatMap((progress) =>
			progress.phase === 'indexing' ? [progress.index] : [],
		)
		expect(new Set(indexes)).toEqual(new Set(Object.keys(RECORD_INDEXES)))
	})

	describe('the transactions of an import', () => {
		/** The contract's runtime, its session's creation probed (before the first record is stored). */
		function runtimeProbingSessionStart(params: { probe: () => void }): StoreRuntime {
			const contract = createContractRuntime()
			return {
				...contract,
				hooks: {
					createImportSession: function probedSession(context) {
						params.probe()
						return contract.hooks!.createImportSession!(context)
					},
				},
			}
		}

		type TestCase = { importWindowMs?: number; inTransactionAtProgress: boolean }
		const testCases: Record<string, TestCase> = {
			'the default window → the batches share one transaction, synchronous off, the import cache raised':
				{
					inTransactionAtProgress: true,
				},
			'a window of 0 ms → each batch committed on its own, synchronous off, the import cache raised':
				{
					importWindowMs: 0,
					inTransactionAtProgress: false,
				},
		}
		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const importCacheMiB = deviceCacheMiB({ deviceMemoryGiB: reportedDeviceMemoryGiB() })
				const sqlite3 = await loadSqlite()
				let db: Database | undefined
				let atSessionStart: Pragmas | undefined
				const started = await startImportEngine({
					options: {
						steadyCacheMiB: STEADY_CACHE_MIB,
						...(testCase.importWindowMs !== undefined && {
							importWindowMs: testCase.importWindowMs,
						}),
					},
					runtime: runtimeProbingSessionStart({
						probe: function probeAtSessionStart() {
							atSessionStart ??= pragmasOf({ db: db!, sqlite3 })
						},
					}),
				})
				db = started.db
				let atProgress: Pragmas | undefined
				await started.engine.importFile(
					{
						file: contractFile({ body: sessionRecords(4) }),
						options: { chunkOptions: SMALL_BATCHES },
						writeId: 'w-1',
						clientId: 'c-1',
					},
					function probeAtFirstProgress() {
						atProgress ??= pragmasOf({ db: db!, sqlite3 })
					},
				)
				expect(atSessionStart).toMatchObject({ cacheMiB: STEADY_CACHE_MIB })
				expect(atProgress).toEqual({
					synchronous: 0,
					journal: 'truncate',
					cacheMiB: importCacheMiB,
					inTransaction: testCase.inTransactionAtProgress,
				})
				expect(pragmasOf({ db, sqlite3 })).toEqual({
					synchronous: 2,
					journal: 'truncate',
					cacheMiB: STEADY_CACHE_MIB,
					inTransaction: false,
				})
			})
		}

		it('a write of another client while an import runs → it lands on its own, the connection durable again, the import cache kept', async () => {
			const sqlite3 = await loadSqlite()
			const { engine, db } = await startImportEngine({
				options: { steadyCacheMiB: STEADY_CACHE_MIB },
			})
			const held = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			expect(pragmasOf({ db, sqlite3 })).toMatchObject({ synchronous: 0, inTransaction: true })
			await engine.registerDocument(makeDocument({ id: 'other' }))
			expect(pragmasOf({ db, sqlite3 })).toEqual({
				synchronous: 2,
				journal: 'truncate',
				cacheMiB: deviceCacheMiB({ deviceMemoryGiB: reportedDeviceMemoryGiB() }),
				inTransaction: false,
			})
			held.release()
			await held.importing
		})

		/** An edit of the document `other` (one record, one commit in its history), and the records it holds after. */
		const EDITS_OF_ANOTHER_CLIENT: Record<
			string,
			{ run: (engine: SqliteEngine) => Promise<void>; expectedCount: number }
		> = {
			'a commit': {
				run: (engine) =>
					engine.commit({
						documentId: 'other',
						writeId: 'w-commit',
						creates: [makeRecord({ id: 'o2' })],
						updates: [],
						deletes: [],
					}),
				expectedCount: 2,
			},
			'an undo': {
				run: async (engine) => {
					await engine.undo('other')
				},
				expectedCount: 0,
			},
			'a redo': {
				run: async (engine) => {
					await engine.undo('other')
					await engine.redo('other')
				},
				expectedCount: 1,
			},
		}
		for (const [edit, { run, expectedCount }] of Object.entries(EDITS_OF_ANOTHER_CLIENT)) {
			it(`${edit} of another client while an import runs → it lands on its own, durable, no transaction left open; the import then ends ready`, async () => {
				const sqlite3 = await loadSqlite()
				const { engine, db } = await startImportEngine()
				await engine.registerDocument(makeDocument({ id: 'other' }))
				await engine.commit({
					documentId: 'other',
					writeId: 'w-seed',
					creates: [makeRecord({ id: 'o1' })],
					updates: [],
					deletes: [],
				})
				const held = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
				expect(pragmasOf({ db, sqlite3 })).toMatchObject({ synchronous: 0, inTransaction: true })
				await run(engine)
				expect(pragmasOf({ db, sqlite3 })).toMatchObject({ synchronous: 2, inTransaction: false })
				const countOther = await engine.count('other')
				expect(countOther).toBe(expectedCount)
				held.release()
				const result = (await held.importing) as { record: { id: string; status: string } }
				expect(result.record.status).toBe('ready')
				const count = await engine.count(result.record.id)
				expect(count).toBe(2)
			})
		}

		it('a commit asked from a task queued at an import’s first progress, a window of 0 ms → it lands before the next progress, not after the import', async () => {
			const { engine } = await startImportEngine({ options: { importWindowMs: 0 } })
			await engine.registerDocument(makeDocument({ id: 'other' }))
			const told: number[] = []
			let committed: Promise<number> | undefined
			await engine.importFile(
				{
					file: contractFile({ body: sessionRecords(6) }),
					options: { chunkOptions: SMALL_BATCHES },
					writeId: 'w-1',
					clientId: 'c-1',
				},
				function commitAtFirstProgress(progress: ImportProgress) {
					if (told.length === 0) {
						setTimeout(() => {
							committed = engine
								.commit({
									documentId: 'other',
									writeId: 'w-commit',
									creates: [makeRecord({ id: 'o1' })],
									updates: [],
									deletes: [],
								})
								.then(() => told.length)
						}, 0)
					}
					told.push(progress.bytesRead)
				},
			)
			expect(told.length).toBeGreaterThan(2)
			const committedSettled = await committed
			expect(committedSettled).toBe(1)
		})

		it('the commit of the import’s window failing for a write of another client → that write refused, the import refused STORE_COMMIT_FAILED, nothing of it left', async () => {
			const sqlite3 = await loadSqlite()
			const { engine, db } = await startImportEngine({
				options: { steadyCacheMiB: STEADY_CACHE_MIB },
			})
			const held = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			let refusals = 0
			// refuses the next commit only: the commit of the import's open window
			sqlite3.capi.sqlite3_commit_hook(
				db,
				function refuseOnce() {
					refusals += 1
					return refusals === 1 ? 1 : 0
				},
				0,
			)
			try {
				await expectRejectsWith({
					action: engine.registerDocument(makeDocument({ id: 'other' })),
					key: 'STORE_COMMIT_FAILED',
				})
			} finally {
				sqlite3.capi.sqlite3_commit_hook(db, 0, 0)
			}
			held.release()
			await expectRejectsWith({ action: held.importing, key: 'STORE_COMMIT_FAILED' })
			const documents = await engine.getDocuments()
			expect(documents).toEqual([])
			expect(pragmasOf({ db, sqlite3 })).toEqual(DURABLE)
			const writeOutcomeW1 = await engine.getWriteOutcome({ writeId: 'w-1' })
			expect(writeOutcomeW1).toBe('not-applied')
		})

		it('an import that fails → synchronous full, the steady cache, no transaction left open', async () => {
			const sqlite3 = await loadSqlite()
			const { engine, db } = await startImportEngine({
				options: { steadyCacheMiB: STEADY_CACHE_MIB },
			})
			await expectRejectsWith({
				action: engine.importFile({
					file: contractFile({ body: `${sessionRecords(2)}<B aB="x" bB="fail"/>` }),
					options: { chunkOptions: SMALL_BATCHES },
					writeId: 'w-1',
					clientId: 'c-1',
				}),
				key: 'IMPORT_FAILED',
			})
			expect(pragmasOf({ db, sqlite3 })).toEqual({
				synchronous: 2,
				journal: 'truncate',
				cacheMiB: STEADY_CACHE_MIB,
				inTransaction: false,
			})
		})
	})

	it('a session creating more records than one bind holds, a window of 0 ms → they are stored a bind at a time, the engine yielding between (after its id index first): a task queued at each turn finds the binds committed so far, no transaction open', async () => {
		const sqlite3 = await loadSqlite()
		const seen: { stored: Promise<unknown[]>; inTransaction: boolean }[] = []
		const contract = createContractRuntime()
		const engineRef: { engine?: SqliteEngine; db?: Database } = {}
		const runtime: StoreRuntime = {
			...contract,
			hooks: {
				createImportSession: function sessionCreatingMany({ documentId }) {
					return {
						afterImport: async function createMany() {
							// one read at each of the engine's first turns: after the id index, after each bind
							setTimeout(function readTheTable() {
								seen.push({
									stored: engineRef.engine!.getByDocumentId(documentId),
									inTransaction: sqlite3.capi.sqlite3_get_autocommit(engineRef.db!) === 0,
								})
								if (seen.length < 3) setTimeout(readTheTable, 0)
							}, 0)
							return {
								creates: Array.from({ length: 2500 }, (_, index) =>
									makeRecord({ id: `created-${index}` }),
								),
							}
						},
					}
				},
			},
		}
		const { engine, db } = await startImportEngine({ options: { importWindowMs: 0 }, runtime })
		engineRef.engine = engine
		engineRef.db = db
		const result = await engine.importFile({
			file: contractFile({ body: '<A/>' }),
			writeId: 'w-1',
			clientId: 'c-1',
		})
		// read from the table: the root and A, then each bind of the session's creates, committed
		expect(seen.map((read) => read.inTransaction)).toEqual([false, false, false])
		const lengths = await Promise.all(seen.map((read) => read.stored.then((rows) => rows.length)))
		expect(lengths).toEqual([2, 2 + ROWS_PER_BIND, 2 + 2 * ROWS_PER_BIND])
		const count = await engine.count(result.record.id)
		expect(count).toBe(2 + 2500)
	})

	it('an import that fails, its window’s ROLLBACK and COMMIT failing too → the engine broken: told once, closed with its connection, its calls refused as its host gone; the next engine on the file finds no trace of the import', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		// from the session's failure on, the window can neither roll back nor commit (a lost handle, no memory)
		const armed = { failing: false }
		const exec = db.exec.bind(db) as (...args: unknown[]) => unknown
		vi.spyOn(db, 'exec').mockImplementation(function execUnlessArmed(...args: unknown[]) {
			const [first] = args
			const sql = typeof first === 'string' ? first : (first as { sql?: string }).sql
			if (armed.failing && (sql === 'ROLLBACK' || sql === 'COMMIT')) {
				throw new Error(`${sql} refused`)
			}
			return exec(...args)
		} as typeof db.exec)
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function failingSession() {
					return {
						afterImport: async function failWithWindowStuck() {
							armed.failing = true
							throw new Error('the session fails')
						},
					}
				},
			},
		}
		let told = 0
		const engine = await startEngine({
			db,
			runtime,
			onBroken: function countBroken() {
				told += 1
			},
		})
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: '<B aB="B0"/>' }),
				writeId: 'w-stuck',
				clientId: 'c-1',
			}),
			key: 'IMPORT_FAILED',
		})
		armed.failing = false
		expect(told).toBe(1)
		expect(db.isOpen()).toBe(false)
		// the caller's store never closed: its host is gone, a read is made again on the next engine
		await expectRejectsWith({
			action: engine.getDocuments(),
			key: 'STORE_CONNECTION_LOST',
			meta: { reason: 'host-gone' },
		})
		const next = await startEngine({ db: file.connect() })
		const documents = await next.getDocuments()
		expect(documents).toEqual([])
		next.close()
	})

	it('a window of 0 ms → a task queued at a progress runs before the next one: the engine yields after each transaction', async () => {
		const { engine } = await startImportEngine({ options: { importWindowMs: 0 } })
		const told: number[] = []
		let toldWhenTaskRan: number[] | undefined
		await engine.importFile(
			{
				file: contractFile({ body: sessionRecords(6) }),
				options: { chunkOptions: SMALL_BATCHES },
				writeId: 'w-1',
				clientId: 'c-1',
			},
			function recordProgress(progress: ImportProgress) {
				if (told.length === 0) setTimeout(() => (toldWhenTaskRan = [...told]), 0)
				told.push(progress.bytesRead)
			},
		)
		expect(told.length).toBeGreaterThan(2)
		expect(toldWhenTaskRan).toEqual(told.slice(0, 1))
	})

	describe('the phases an import tells', () => {
		/** The phases told, a run of the same phase said once. */
		function phaseRuns(params: { progress: ImportProgress[] }): string[] {
			return params.progress
				.map((step) => step.phase)
				.filter((phase, index, phases) => phase !== phases[index - 1])
		}

		const testCases: Record<string, { body: string; runs: ImportProgress['phase'][] }> = {
			'a session that writes after the parse → indexing twice (the id index in its writes, the tag index at the end), each followed by the phase it was in, after the whole file':
				{
					body: sessionRecords(2),
					runs: [
						'storing',
						'processing',
						'checking',
						'applying',
						'indexing',
						'applying',
						'finishing',
						'indexing',
						'finishing',
					],
				},
			'a session that writes nothing → indexing twice at the end, each followed by finishing, after the whole file':
				{
					body: '<A/><C/>',
					runs: [
						'storing',
						'processing',
						'checking',
						'finishing',
						'indexing',
						'finishing',
						'indexing',
						'finishing',
					],
				},
		}
		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const { engine } = await startImportEngine()
				const file = contractFile({ body: testCase.body })
				const progress: ImportProgress[] = []
				await engine.importFile(
					{ file, options: { chunkOptions: SMALL_BATCHES }, writeId: 'w-1', clientId: 'c-1' },
					function recordProgress(step: ImportProgress) {
						progress.push(step)
					},
				)
				expect(phaseRuns({ progress })).toEqual(testCase.runs)
				const indexing = progress.filter((step) => step.phase === 'indexing')
				expect(indexing).toEqual([
					{ phase: 'indexing', index: 'id', bytesRead: file.size, totalBytes: file.size },
					{ phase: 'indexing', index: 'tag', bytesRead: file.size, totalBytes: file.size },
				])
			})
		}
	})

	describe('the connection after an import that ends early', () => {
		type TestCase = { end: (engine: SqliteEngine) => void | Promise<void> }
		const testCases: Record<string, TestCase> = {
			'its import aborted by its id while it runs → IMPORT_ABORTED; the connection durable again': {
				end: (engine) => engine.abortImport({ writeId: 'w-1' }),
			},
			'the imports of its client aborted while it runs → IMPORT_ABORTED; the connection durable again':
				{
					end: (engine) => engine.abortImportsOf({ clientId: 'c-1' }),
				},
		}
		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const sqlite3 = await loadSqlite()
				const { engine, db } = await startImportEngine({
					options: { steadyCacheMiB: STEADY_CACHE_MIB },
				})
				const held = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
				expect(pragmasOf({ db, sqlite3 })).toMatchObject({ synchronous: 0, inTransaction: true })
				await testCase.end(engine)
				held.release()
				await expectRejectsWith({ action: held.importing, key: 'IMPORT_ABORTED' })
				expect(pragmasOf({ db, sqlite3 })).toEqual(DURABLE)
				const documents = await engine.getDocuments()
				expect(documents).toEqual([])
			})
		}

		it('a failing import whose rollback fails too → its own failure thrown (IMPORT_FAILED), nothing of it left, no transaction open, the connection durable at its steady cache', async () => {
			const sqlite3 = await loadSqlite()
			const { engine, db } = await startImportEngine({
				options: { steadyCacheMiB: STEADY_CACHE_MIB },
			})
			const exec = db.exec.bind(db) as (...args: unknown[]) => unknown
			// every rollback of the import refused: the window's transaction stays open
			db.exec = function refuseRollback(...args: unknown[]) {
				if (args[0] === 'ROLLBACK') throw new Error('rollback refused')
				return exec(...args)
			} as unknown as Database['exec']
			try {
				await expectRejectsWith({
					action: engine.importFile({
						file: contractFile({ body: `${sessionRecords(2)}<B aB="x" bB="fail"/>` }),
						writeId: 'w-1',
						clientId: 'c-1',
					}),
					key: 'IMPORT_FAILED',
				})
				expect(pragmasOf({ db, sqlite3 })).toEqual(DURABLE)
				const documents = await engine.getDocuments()
				expect(documents).toEqual([])
			} finally {
				db.exec = exec as unknown as Database['exec']
				if (sqlite3.capi.sqlite3_get_autocommit(db) === 0) db.exec('ROLLBACK')
			}
		})
	})

	describe('an engine closed while it imports', () => {
		it('closed while the session holds the import → IMPORT_ABORTED; the engine then refuses STORE_CLOSED', async () => {
			const { engine } = await startImportEngine()
			const first = await startHeldImport({ engine, writeId: 'w-1', clientId: 'c-1' })
			engine.close()
			first.release()
			await expectRejectsWith({ action: first.importing, key: 'IMPORT_ABORTED' })
			await expectRejectsWith({ action: engine.getDocuments(), key: 'STORE_CLOSED' })
		})

		it('closed from another task while an index is built → IMPORT_ABORTED, nothing else thrown', async () => {
			const { engine } = await startImportEngine({ options: { importWindowMs: 0 } })
			let closing: ReturnType<typeof setTimeout> | undefined
			const importing = engine.importFile(
				{ file: contractFile({ body: sessionRecords(2) }), writeId: 'w-1', clientId: 'c-1' },
				function closeAtIndexing(progress: ImportProgress) {
					if (progress.phase !== 'indexing') return
					closing ??= setTimeout(() => engine.close(), 0)
				},
			)
			await expectRejectsWith({ action: importing, key: 'IMPORT_ABORTED' })
		})

		it('closed from another task while the file is parsed → IMPORT_ABORTED, nothing else thrown', async () => {
			const { engine } = await startImportEngine({ options: { importWindowMs: 0 } })
			let closing: ReturnType<typeof setTimeout> | undefined
			const importing = engine.importFile(
				{
					file: contractFile({ body: sessionRecords(6) }),
					options: { chunkOptions: SMALL_BATCHES },
					writeId: 'w-1',
					clientId: 'c-1',
				},
				function closeFromATask(_progress: ImportProgress) {
					closing ??= setTimeout(() => engine.close(), 0)
				},
			)
			await expectRejectsWith({ action: importing, key: 'IMPORT_ABORTED' })
		})
	})
})
