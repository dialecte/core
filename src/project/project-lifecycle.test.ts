import { xmlFile } from './import.fixtures'
import { document } from './open-sweep.fixtures'
import { Project } from './project'
import { CLOSE_WAIT_REPORT_MS } from './project.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { rejectionKey } from '@/errors/errors.fixtures'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig, BlobAttachment, BlobRecord } from '@/types'

// A Project's open, close and destroy run one at a time, in the order called; an open on a Project already open
// first closes it wholly. A project whose store refuses to open (its database lost) is reset by destroying it on
// the Project whose open was refused, then opening it again.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

/** An in-memory store counting its opens and closes, refusing to open while `refusing`, as a lost database does. */
class CountingStore extends InMemoryStore {
	refusing = false
	opens = 0
	closeCalls = 0
	destroys = 0

	override async open(): Promise<void> {
		if (this.refusing) {
			throw createDialecteError('PROJECT_DATABASE_LOST', {
				detail: `Project "${this.name}" holds data but its database is gone`,
				meta: { project: this.name },
			})
		}
		this.opens += 1
		await super.open()
		this.armedGate = this.hydrationGate
		this.hydrationGate = undefined
		this.failHydration = this.hydrationFailure
		this.hydrationFailure = undefined
	}

	/** Once set, the next close settles only once it is let go (as a store waiting for its hub). */
	closeGate: Promise<void> | undefined

	override async close(): Promise<void> {
		this.closeCalls += 1
		const gate = this.closeGate
		this.closeGate = undefined
		await super.close()
		await gate
	}

	/** Once set, the first `getDocuments` after the store opened (the Project's hydration) says so, then waits. */
	hydrationGate: { reached: () => void; released: Promise<void> } | undefined
	private armedGate: { reached: () => void; released: Promise<void> } | undefined

	override async getDocuments(): ReturnType<InMemoryStore['getDocuments']> {
		const failure = this.failHydration
		this.failHydration = undefined
		if (failure) throw failure
		const gate = this.armedGate
		this.armedGate = undefined
		if (gate) {
			gate.reached()
			await gate.released
		}
		return super.getDocuments()
	}

	/** Once set, the next call of `method` says it was reached, then waits to be released before it runs. */
	hold: { method: HeldMethod; reached: () => void; released: Promise<void> } | undefined
	/** Once set, the hydration's `getDocuments` (the first after the store opened) throws it. */
	hydrationFailure: Error | undefined
	private failHydration: Error | undefined

	private async passHold(method: HeldMethod): Promise<void> {
		const hold = this.hold
		if (hold?.method !== method) return
		this.hold = undefined
		hold.reached()
		await hold.released
	}

	override async registerDocument(
		file: Parameters<InMemoryStore['registerDocument']>[0],
	): Promise<void> {
		await this.passHold('registerDocument')
		return super.registerDocument(file)
	}

	override async importFile(
		params: Parameters<InMemoryStore['importFile']>[0],
	): ReturnType<InMemoryStore['importFile']> {
		await this.passHold('importFile')
		return super.importFile(params)
	}

	override async removeDocument(documentId: string): Promise<void> {
		await this.passHold('removeDocument')
		return super.removeDocument(documentId)
	}

	override async undo(documentId: string): Promise<void> {
		await this.passHold('undo')
		return super.undo(documentId)
	}

	override async redo(documentId: string): Promise<void> {
		await this.passHold('redo')
		return super.redo(documentId)
	}

	override async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		await this.passHold('addBlob')
		return super.addBlob(entry, data)
	}

	override async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		await this.passHold('attachBlob')
		return super.attachBlob(blobId, ref)
	}

	override async detachBlob(
		blobId: string,
		ref: { documentId: string; recordRef: string },
	): Promise<void> {
		await this.passHold('detachBlob')
		return super.detachBlob(blobId, ref)
	}

	override async removeBlob(blobId: string): Promise<void> {
		await this.passHold('removeBlob')
		return super.removeBlob(blobId)
	}

	/** Once set, the next commit, written, says so, then waits to be released before it answers. */
	commitGate: { reached: () => void; released: Promise<void> } | undefined

	override async commit(
		params: Parameters<InMemoryStore['commit']>[0],
	): ReturnType<InMemoryStore['commit']> {
		const gate = this.commitGate
		this.commitGate = undefined
		await this.passHold('commit')
		const committed = await super.commit(params)
		if (gate) {
			gate.reached()
			await gate.released
		}
		return committed
	}

	override async destroy(): Promise<void> {
		this.destroys += 1
		this.refusing = false
		return super.destroy()
	}
}

/** The store methods a case holds: the writes a close waits for. */
type HeldMethod =
	| 'importFile'
	| 'registerDocument'
	| 'removeDocument'
	| 'undo'
	| 'redo'
	| 'addBlob'
	| 'attachBlob'
	| 'detachBlob'
	| 'removeBlob'
	| 'commit'

/** A hold for `method` on `store`: `reached` once the call arrived, `release` to let it run. */
function holdOn(params: { store: CountingStore; method: HeldMethod }): {
	reached: Promise<void>
	release: () => void
} {
	let arrived: () => void = () => {}
	let release: () => void = () => {}
	const reached = new Promise<void>(function waitForCall(resolve) {
		arrived = resolve
	})
	params.store.hold = {
		method: params.method,
		reached: () => arrived(),
		released: new Promise<void>(function holdCall(resolve) {
			release = resolve
		}),
	}
	return { reached, release }
}

/** The microtasks and one macrotask pass: what a close would have done by now if it waited for nothing. */
function flush(): Promise<void> {
	return new Promise(function afterTimers(resolve) {
		setTimeout(resolve, 0)
	})
}

/** A project name of its own: in-memory stores keep what they hold per name across cases. */
function uniqueName(params: { prefix: string }): string {
	return `${params.prefix}-${crypto.randomUUID()}`
}

/** A store of `name` holding one document, closed; refusing to open from then on when `refusing`. */
async function storeWithDocument(params: {
	name: string
	refusing: boolean
}): Promise<CountingStore> {
	const store = new CountingStore(params.name, { runtime: RUNTIME })
	await store.open()
	await store.registerDocument(document({ id: params.name, status: 'ready' }))
	store.close()
	store.refusing = params.refusing
	store.opens = 0
	store.closeCalls = 0
	return store
}

/** The ids of the documents a store holds, read by opening and closing it. */
async function documentIdsOf(store: CountingStore): Promise<string[]> {
	await store.open()
	const documents = await store.getDocuments()
	store.close()
	return documents.map(function idOf(listed) {
		return listed.id
	})
}

/** A Project on custom storage whose store follows the project it opens: each name its own store. */
function projectOver(stores: Record<string, CountingStore>): Project<AnyDialecteConfig> {
	let project: Project<AnyDialecteConfig> | undefined
	project = new Project({
		configs: { default: CONFIG },
		storage: {
			type: 'custom',
			get store(): CountingStore {
				return stores[project!.name]!
			},
		},
	})
	return project
}

describe('Project - an open its store refuses, then destroy() on that Project', () => {
	const before = {
		'a fresh Project': { other: 'none' },
		'a Project that opened and closed another project': { other: 'closed' },
		'a Project still open on another project': { other: 'open' },
	} satisfies Record<string, { other: 'none' | 'closed' | 'open' }>

	it.each(Object.entries(before))(
		'%s → the refused project destroyed, never opened; the other kept and closed; opened again empty',
		async (_label, { other: otherState }) => {
			const otherName = uniqueName({ prefix: 'other' })
			const lostName = uniqueName({ prefix: 'lost' })
			const other = await storeWithDocument({ name: otherName, refusing: false })
			const lost = await storeWithDocument({ name: lostName, refusing: true })
			const project = projectOver({ [otherName]: other, [lostName]: lost })
			if (otherState !== 'none') await project.open(otherName)
			if (otherState === 'closed') await project.close()
			expect(await rejectionKey({ action: project.open(lostName) })).toBe('PROJECT_DATABASE_LOST')
			// what that open opened is closed again: nothing of it is left open
			expect(lost.closeCalls).toBe(1)
			if (otherState !== 'none') expect(other.closeCalls).toBe(1)
			await project.destroy()
			expect({ destroyed: lost.destroys, opened: lost.opens }).toEqual({ destroyed: 1, opened: 0 })
			expect(other.destroys).toBe(0)
			expect(await documentIdsOf(other)).toEqual([otherName])
			await project.open(lostName)
			expect(await project.getDocuments()).toEqual([])
			await project.destroy()
		},
	)

	it('closed after the refusal → nothing more closed; the next open refused the same', async () => {
		const lostName = uniqueName({ prefix: 'refused-close' })
		const lost = await storeWithDocument({ name: lostName, refusing: true })
		const project = projectOver({ [lostName]: lost })
		expect(await rejectionKey({ action: project.open(lostName) })).toBe('PROJECT_DATABASE_LOST')
		await project.close()
		expect(lost.closeCalls).toBe(1)
		expect(await rejectionKey({ action: project.open(lostName) })).toBe('PROJECT_DATABASE_LOST')
		await project.destroy()
	})
})

/** The three projects an ordering case opens and destroys. */
type OrderNames = { a: string; b: string; c: string }

/** The calls a case makes without waiting, on a Project open on `a`. */
type OrderCalls = (params: {
	project: Project<AnyDialecteConfig>
	names: OrderNames
}) => Promise<unknown>[]

const destroyThenOpen: OrderCalls = function destroyThenOpen({ project, names }) {
	return [project.destroy(), project.open(names.c)]
}

const openThenDestroy: OrderCalls = function openThenDestroy({ project, names }) {
	return [project.open(names.c), project.destroy()]
}

const openTwice: OrderCalls = function openTwice({ project, names }) {
	return [project.open(names.b), project.open(names.c)]
}

const closeThenOpen: OrderCalls = function closeThenOpen({ project, names }) {
	return [project.close(), project.open(names.c)]
}

const openThenClose: OrderCalls = function openThenClose({ project, names }) {
	return [project.open(names.c), project.close()]
}

describe('Project - open, close and destroy called without waiting run one at a time, in that order', () => {
	const orders = {
		'destroy(), then open() of another project': {
			calls: destroyThenOpen,
			destroyed: 'a',
			openAs: 'c',
		},
		'open() of another project, then destroy()': {
			calls: openThenDestroy,
			destroyed: 'c',
			openAs: undefined,
		},
		'two open() of other projects': { calls: openTwice, destroyed: undefined, openAs: 'c' },
		'close(), then open() of another project': {
			calls: closeThenOpen,
			destroyed: undefined,
			openAs: 'c',
		},
		'open() of another project, then close()': {
			calls: openThenClose,
			destroyed: undefined,
			openAs: undefined,
		},
	} satisfies Record<
		string,
		{
			calls: OrderCalls
			destroyed: keyof OrderNames | undefined
			openAs: keyof OrderNames | undefined
		}
	>

	it.each(Object.entries(orders))(
		'%s → each on the project named when it was called; the only store left open is the open project’s',
		async (_label, { calls, destroyed, openAs }) => {
			const names: OrderNames = {
				a: uniqueName({ prefix: 'order-a' }),
				b: uniqueName({ prefix: 'order-b' }),
				c: uniqueName({ prefix: 'order-c' }),
			}
			const stores: Record<keyof OrderNames, CountingStore> = {
				a: await storeWithDocument({ name: names.a, refusing: false }),
				b: await storeWithDocument({ name: names.b, refusing: false }),
				c: await storeWithDocument({ name: names.c, refusing: false }),
			}
			const project = projectOver({ [names.a]: stores.a, [names.b]: stores.b, [names.c]: stores.c })
			await project.open(names.a)
			await Promise.all(calls({ project, names }))
			for (const key of ['a', 'b', 'c'] as const) {
				const store = stores[key]
				expect({ key, destroyed: store.destroys > 0 }).toEqual({
					key,
					destroyed: key === destroyed,
				})
				// a store is open when it was opened more often than closed: only the open project's
				expect({ key, open: store.opens > store.closeCalls }).toEqual({ key, open: key === openAs })
			}
			if (openAs !== undefined) {
				expect(project.name).toBe(names[openAs])
				expect([...project.state.documents.keys()]).toEqual([names[openAs]])
				await project.destroy()
			}
		},
	)
})

describe('Project - open() on a Project already open closes it wholly first', () => {
	const reopenings = {
		'another project': { same: false },
		'the same project': { same: true },
	} satisfies Record<string, { same: boolean }>

	it.each(Object.entries(reopenings))(
		'%s → only its documents in the state; a Document of the previous open answers STORE_CLOSED',
		async (_label, { same }) => {
			const first = uniqueName({ prefix: 'switch' })
			const next = same ? first : uniqueName({ prefix: 'switch' })
			const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
			await project.open(first)
			const previousId = await project.initEmptyDocument()
			const previous = project.openDocument(previousId)
			await project.open(next)
			expect([...project.state.documents.keys()]).toEqual(same ? [previousId] : [])
			expect(await rejectionKey({ action: previous.query.getRoot() })).toBe('STORE_CLOSED')
			if (!same) {
				expect(
					await rejectionKey({
						action: Promise.resolve().then(function openPrevious() {
							return project.openDocument(previousId)
						}),
					}),
				).toBe('DOCUMENT_NOT_REGISTERED')
			}
			await project.destroy()
			if (!same) {
				await project.open(first)
				await project.destroy()
			}
		},
	)

	it('an import called right after open() of another project → refused PROJECT_NOT_OPENED, as after close()', async () => {
		const a = uniqueName({ prefix: 'after-open-a' })
		const b = uniqueName({ prefix: 'after-open-b' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(a)
		const switching = project.open(b)
		const importing = project.importFile(xmlFile({ body: '<A/>', name: 'late.xml' }))
		expect(await rejectionKey({ action: importing })).toBe('PROJECT_NOT_OPENED')
		await switching
		await project.destroy()
		await project.open(a)
		expect([...project.state.documents.keys()]).toEqual([])
		await project.destroy()
	})

	it('a call made while a close() waits behind an open() → refused PROJECT_NOT_OPENED, the open done or not', async () => {
		const name = uniqueName({ prefix: 'close-behind-open' })
		const store = await storeWithDocument({ name, refusing: false })
		let reached: () => void = () => {}
		const hydrating = new Promise<void>(function waitForHydration(resolve) {
			reached = resolve
		})
		let release: () => void = () => {}
		store.hydrationGate = {
			reached: () => reached(),
			released: new Promise<void>(function holdHydration(resolve) {
				release = resolve
			}),
		}
		const project = projectOver({ [name]: store })
		const opening = project.open(name)
		const closing = project.close()
		await hydrating
		const importing = project.importFile(xmlFile({ body: '<A/>', name: 'between.xml' }))
		release()
		await opening
		expect(await rejectionKey({ action: importing })).toBe('PROJECT_NOT_OPENED')
		await closing
		await project.destroy()
	})

	it('a batch import() of the previous project, not awaited, then open() of another → the file in flight lands there, the others refused as after close(); the next project holds none', async () => {
		const a = uniqueName({ prefix: 'batch-a' })
		const b = uniqueName({ prefix: 'batch-b' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(a)
		// enough files that the ones after the file in flight outlast the switch to the next project
		const files = Array.from({ length: 20 }, function fileOf(_, index) {
			return xmlFile({ body: '<A/>', name: `file-${index}.xml` })
		})
		const importing = project.import(files)
		const switching = project.open(b)
		const entries = await importing
		await switching
		expect(
			entries.map(function outcomeOf(entry) {
				return entry.status === 'failed' ? entry.error.key : entry.status
			}),
		).toEqual(['imported', ...Array.from({ length: 19 }, () => 'PROJECT_NOT_OPENED')])
		expect([...project.state.documents.keys()]).toEqual([])
		await project.destroy()
		await project.open(a)
		expect(project.state.documents.size).toBe(1)
		await project.destroy()
	})

	it('a document made in the previous project, not awaited, then open() of another → made there; the next project’s state never holds it', async () => {
		const a = uniqueName({ prefix: 'write-a' })
		const b = uniqueName({ prefix: 'write-b' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(a)
		const making = project.initEmptyDocument()
		const switching = project.open(b)
		const madeId = await making
		await switching
		expect([...project.state.documents.keys()]).toEqual([])
		await project.destroy()
		await project.open(a)
		expect([...project.state.documents.keys()]).toEqual([madeId])
		await project.destroy()
	})

	it('a Document of the previous open, subscribing after the same project opened again → told nothing of the next open', async () => {
		const name = uniqueName({ prefix: 'late-subscribe' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(name)
		const documentId = await project.initEmptyDocument()
		const previous = project.openDocument(documentId)
		await project.open(name)
		let told = 0
		previous.subscribe(function countSignal() {
			told += 1
		})
		await project.openDocument(documentId).transaction(async function changeNothing() {})
		expect(told).toBe(0)
		await project.destroy()
	})

	it('a Document of the previous open, the same custom store opened again → its commit writes; posted once, as the store tells it (the Document’s own post reaches no later open)', async () => {
		const name = uniqueName({ prefix: 'reused-store' })
		const store = new CountingStore(name, { runtime: RUNTIME })
		const project = projectOver({ [name]: store })
		await project.open(name)
		const { documentId } = await project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
		const previous = project.openDocument(documentId)
		await project.open(name)
		const heard: unknown[] = []
		const listener = new BroadcastChannel(project.channelName)
		listener.onmessage = function hear(event) {
			heard.push(event.data)
		}
		await previous.transaction(async function addOne(tx) {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})
		await new Promise(function letMessagesArrive(resolve) {
			setTimeout(resolve, 20)
		})
		listener.close()
		expect(heard).toEqual([expect.objectContaining({ type: 'commit', documentId })])
		await project.destroy()
	})

	it('a Document of the previous open, subscribed → not told of the changes of the next open, the same project', async () => {
		const name = uniqueName({ prefix: 'subscribed' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(name)
		const documentId = await project.initEmptyDocument()
		let told = 0
		project.openDocument(documentId).subscribe(function countSignal() {
			told += 1
		})
		await project.open(name)
		await project.openDocument(documentId).transaction(async function changeNothing() {})
		expect(told).toBe(0)
		await project.destroy()
	})

	it('an import of the previous project queued, not awaited → it lands there; the next project’s state never holds it', async () => {
		const a = uniqueName({ prefix: 'queued-a' })
		const b = uniqueName({ prefix: 'queued-b' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		await project.open(a)
		const first = project.importFile(xmlFile({ body: '<A aA="1"/>', name: 'first.xml' }))
		const queued = project.importFile(xmlFile({ body: '<A aA="2"/>', name: 'queued.xml' }))
		const switching = project.open(b)
		const [firstImported, queuedImported] = await Promise.all([first, queued])
		await switching
		expect([...project.state.documents.keys()]).toEqual([])
		await project.open(a)
		expect([...project.state.documents.keys()].sort()).toEqual(
			[firstImported.documentId, queuedImported.documentId].sort(),
		)
		await project.destroy()
		await project.open(b)
		await project.destroy()
	})
})

/** A write of the open project, the store method it goes through, and what it needs first. */
type HeldWrite = {
	method: HeldMethod
	write: (context: WriteContext) => Promise<unknown>
}
type WriteContext = { project: Project<AnyDialecteConfig>; documentId: string; blobId: string }

const ATTACHED: BlobAttachment = { documentId: '', recordRef: 'root' }

describe('Project - a close waits for the writes running', () => {
	const writes = {
		'a document made': {
			method: 'registerDocument',
			write: ({ project }) => project.initEmptyDocument(),
		},
		'a document removed': {
			method: 'removeDocument',
			write: ({ project, documentId }) => project.removeDocument(documentId),
		},
		'an undo': { method: 'undo', write: ({ project, documentId }) => project.undo(documentId) },
		'a redo': {
			method: 'redo',
			write: async ({ project, documentId }) => {
				await project.undo(documentId)
				return project.redo(documentId)
			},
		},
		'a blob added': {
			method: 'addBlob',
			write: ({ project, documentId }) =>
				project.addBlob(documentId, new File(['b'], 'b.txt', { type: 'text/plain' })),
		},
		'a blob attached': {
			method: 'attachBlob',
			write: ({ project, documentId, blobId }) =>
				project.attachBlob(blobId, { ...ATTACHED, documentId }),
		},
		'a blob detached': {
			method: 'detachBlob',
			write: async ({ project, documentId, blobId }) => {
				await project.attachBlob(blobId, { ...ATTACHED, documentId })
				return project.detachBlob(blobId, { ...ATTACHED, documentId })
			},
		},
		'a blob removed': {
			method: 'removeBlob',
			write: ({ project, blobId }) => project.removeBlob(blobId),
		},
		'a Document’s transaction': {
			method: 'commit',
			write: ({ project, documentId }) =>
				project.openDocument(documentId).transaction(async function addOne(tx) {
					const root = await tx.getRoot()
					tx.addChild(root, { tagName: 'A', attributes: [] })
				}),
		},
		'a Document’s prepared commit': {
			method: 'commit',
			write: async ({ project, documentId }) => {
				const prepared = await project.openDocument(documentId).prepare(async function addOne(tx) {
					const root = await tx.getRoot()
					tx.addChild(root, { tagName: 'A', attributes: [] })
				})
				return prepared.commit()
			},
		},
	} satisfies Record<string, HeldWrite>

	it.each(Object.entries(writes))(
		'%s → held in the store, close() waits for it: it lands, then the store closes',
		async (_label, { method, write }) => {
			const name = uniqueName({ prefix: `write-${method}` })
			const store = new CountingStore(name, { runtime: RUNTIME })
			const project = projectOver({ [name]: store })
			await project.open(name)
			const { documentId } = await project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
			// a history step for undo and redo, a blob for the blob writes
			await project.openDocument(documentId).transaction(async function addOne(tx) {
				const root = await tx.getRoot()
				tx.addChild(root, { tagName: 'A', attributes: [] })
			})
			const blobId = await project.addBlob(
				documentId,
				new File(['a'], 'a.txt', { type: 'text/plain' }),
			)
			const { reached, release } = holdOn({ store, method })
			const writing = write({ project, documentId, blobId })
			await reached
			const closing = project.close()
			await flush()
			expect(store.closeCalls).toBe(0)
			release()
			expect(await rejectionKey({ action: writing })).toBe('resolved')
			await closing
			expect(store.closeCalls).toBe(1)
			await project.destroy()
		},
	)

	const lateWrites = {
		'a Document’s transaction': {
			write: (doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>) =>
				doc.transaction(async function addOne(tx) {
					const root = await tx.getRoot()
					tx.addChild(root, { tagName: 'A', attributes: [] })
				}),
		},
		'a Document’s prepared commit': {
			write: async (doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>) => {
				const prepared = await doc.prepare(async function addOne(tx) {
					const root = await tx.getRoot()
					tx.addChild(root, { tagName: 'A', attributes: [] })
				})
				return prepared.commit()
			},
		},
	}

	it.each(Object.entries(lateWrites))(
		'%s started once close() was called → refused PROJECT_NOT_OPENED, nothing of it written',
		async (_label, { write }) => {
			const name = uniqueName({ prefix: 'late-write' })
			const store = new CountingStore(name, { runtime: RUNTIME })
			const project = projectOver({ [name]: store })
			await project.open(name)
			const { documentId } = await project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
			const doc = project.openDocument(documentId)
			const { reached, release } = holdOn({ store, method: 'registerDocument' })
			const making = project.initEmptyDocument()
			await reached
			const closing = project.close()
			// the hold kept until the refusal: the close cannot finish first
			expect(await rejectionKey({ action: write(doc) })).toBe('PROJECT_NOT_OPENED')
			release()
			await making
			await closing
			await project.open(name)
			const records = await store.getByDocumentId(documentId)
			expect(
				records.filter(function isA(record) {
					return record.tagName === 'A'
				}),
			).toHaveLength(1)
			await project.destroy()
		},
	)

	const throwingSubscribers = {
		'as it starts': { terminal: false },
		'as it ends': { terminal: true },
	} satisfies Record<string, { terminal: boolean }>

	it.each(Object.entries(throwingSubscribers))(
		'a Document’s transaction whose subscriber throws %s → the write ended all the same: close() is not held',
		async (_label, { terminal: failingAt }) => {
			const name = uniqueName({ prefix: 'throwing-subscriber' })
			const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
			await project.open(name)
			const documentId = await project.initEmptyDocument()
			const doc = project.openDocument(documentId)
			doc.subscribe(function throwOnce(terminal) {
				if (terminal === failingAt) throw new Error('a subscriber failing')
			})
			// a failure inside the transaction reports as any non-structured one does; the last signal's throw is its own
			const expected = failingAt ? 'Error: a subscriber failing' : 'UNKNOWN'
			expect(await rejectionKey({ action: doc.transaction(async function nothing() {}) })).toBe(
				expected,
			)
			// the Document is not left holding a transaction: the next one runs, failing the same way
			expect(await rejectionKey({ action: doc.transaction(async function nothing() {}) })).toBe(
				expected,
			)
			const closed = await Promise.race([
				project.close().then(() => 'closed'),
				new Promise<string>(function giveUp(resolve) {
					setTimeout(() => resolve('still waiting'), 1_000)
				}),
			])
			expect(closed).toBe('closed')
			await project.destroy()
		},
	)

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('a store whose close takes a while → the project’s close settled only once the store’s has', async () => {
		const name = uniqueName({ prefix: 'slow-close' })
		const store = new CountingStore(name, { runtime: RUNTIME })
		const project = projectOver({ [name]: store })
		await project.open(name)
		let letGo: () => void = function stillHeld() {}
		store.closeGate = new Promise<void>(function holdClose(resolve) {
			letGo = resolve
		})
		let closed = false
		const closing = project.close().then(function markClosed() {
			closed = true
		})
		await flush()
		expect(store.closeCalls).toBe(1)
		expect(closed).toBe(false)
		letGo()
		await closing
		expect(closed).toBe(true)
	})

	it('a store close held longer than CLOSE_WAIT_REPORT_MS → the close says so once, and keeps waiting', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		const warn = vi.spyOn(console, 'warn').mockImplementation(function quiet() {})
		const name = uniqueName({ prefix: 'stuck-store-close' })
		const store = new CountingStore(name, { runtime: RUNTIME })
		const project = projectOver({ [name]: store })
		await project.open(name)
		let letGo: () => void = function stillHeld() {}
		store.closeGate = new Promise<void>(function holdClose(resolve) {
			letGo = resolve
		})
		const closing = project.close()
		await vi.advanceTimersByTimeAsync(CLOSE_WAIT_REPORT_MS * 3)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]![0])).toMatch(/then its store's close/)
		letGo()
		await closing
		vi.useRealTimers()
		await project.destroy()
	})

	it('a write held longer than CLOSE_WAIT_REPORT_MS → the close says once what it waits for, and keeps waiting', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		const warn = vi.spyOn(console, 'warn').mockImplementation(function quiet() {})
		const name = uniqueName({ prefix: 'stuck' })
		const store = new CountingStore(name, { runtime: RUNTIME })
		const project = projectOver({ [name]: store })
		await project.open(name)
		const { reached, release } = holdOn({ store, method: 'registerDocument' })
		const making = project.initEmptyDocument()
		await reached
		const closing = project.close()
		await vi.advanceTimersByTimeAsync(CLOSE_WAIT_REPORT_MS * 3)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]![0])).toMatch(
			/0 import\(s\), 1 write\(s\) and 0 other-tab update\(s\)/,
		)
		expect(store.closeCalls).toBe(0)
		release()
		await making
		await closing
		expect(store.closeCalls).toBe(1)
		vi.useRealTimers()
		await project.destroy()
	})

	it('an import held longer than CLOSE_WAIT_REPORT_MS → the close names its file and says an import hook must settle', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		const warn = vi.spyOn(console, 'warn').mockImplementation(function quiet() {})
		const name = uniqueName({ prefix: 'stuck-import' })
		const store = new CountingStore(name, { runtime: RUNTIME })
		const project = projectOver({ [name]: store })
		await project.open(name)
		const { reached, release } = holdOn({ store, method: 'importFile' })
		const importing = project.importFile(new File(['<Root/>'], 'held.xml'))
		await reached
		const closing = project.close()
		await vi.advanceTimersByTimeAsync(CLOSE_WAIT_REPORT_MS * 3)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]![0])).toMatch(
			/1 import\(s\) \("held\.xml": an import hook that never settles keeps it waiting\)/,
		)
		release()
		await importing.catch(function importOutcomeIrrelevant() {})
		await closing
		vi.useRealTimers()
		await project.destroy()
	})
})

describe('Project - a query over every document across a close or an open', () => {
	const events = {
		'queryAll, close() meanwhile': { method: 'queryAll', event: 'close' },
		'queryAll, open() of another project meanwhile': { method: 'queryAll', event: 'open' },
		'queryFirst, close() meanwhile': { method: 'queryFirst', event: 'close' },
		'queryFirst, open() of another project meanwhile': { method: 'queryFirst', event: 'open' },
	} satisfies Record<string, { method: 'queryAll' | 'queryFirst'; event: 'close' | 'open' }>

	it.each(Object.entries(events))(
		'%s → refused PROJECT_NOT_OPENED, never a partial or mixed answer',
		async (_label, { method, event }) => {
			const a = uniqueName({ prefix: 'query-a' })
			const b = uniqueName({ prefix: 'query-b' })
			const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
			await project.open(b)
			await project.initEmptyDocument()
			await project.open(a)
			await project.initEmptyDocument()
			await project.initEmptyDocument()
			let arrived: () => void = () => {}
			const reached = new Promise<void>(function waitForQuery(resolve) {
				arrived = resolve
			})
			let release: () => void = () => {}
			const released = new Promise<void>(function holdQuery(resolve) {
				release = resolve
			})
			let calls = 0
			async function slowFirst(): Promise<undefined> {
				calls += 1
				if (calls === 1) {
					arrived()
					await released
				}
				return undefined
			}
			const querying =
				method === 'queryAll'
					? project.queryAll(async function none() {
							await slowFirst()
							return []
						})
					: project.queryFirst(slowFirst)
			await reached
			await (event === 'close' ? project.close() : project.open(b))
			release()
			expect(await rejectionKey({ action: querying })).toBe('PROJECT_NOT_OPENED')
			await project.destroy()
			await project.open(a)
			await project.destroy()
		},
	)
})

describe('Project - a query over every document of a project not open', () => {
	const queries = {
		queryAll: (project: Project<AnyDialecteConfig>) => project.queryAll(async () => []),
		queryFirst: (project: Project<AnyDialecteConfig>) => project.queryFirst(async () => undefined),
	}

	it.each(Object.entries(queries))(
		'%s after close() → PROJECT_NOT_OPENED, not an empty answer',
		async (_label, query) => {
			const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
			await project.open(uniqueName({ prefix: 'closed-query' }))
			await project.close()
			expect(await rejectionKey({ action: query(project) })).toBe('PROJECT_NOT_OPENED')
			await project.destroy()
		},
	)
})

describe('Project - the order of calls a double open leaves', () => {
	it('open(a) twice without waiting → after the first settles, calls refused until the second has settled', async () => {
		const name = uniqueName({ prefix: 'double-open' })
		const project = new Project({ configs: { default: CONFIG }, storage: { type: 'inMemory' } })
		const first = project.open(name)
		const second = project.open(name)
		await first
		expect(await rejectionKey({ action: project.getDocuments() })).toBe('PROJECT_NOT_OPENED')
		await second
		expect(await project.getDocuments()).toEqual([])
		await project.destroy()
	})
})

describe('Project - an open whose hydration fails', () => {
	it('the store opened, its documents unreadable → refused; the store closed again, the Project closed; destroy() removes it', async () => {
		const name = uniqueName({ prefix: 'hydration' })
		const store = await storeWithDocument({ name, refusing: false })
		store.hydrationFailure = new Error('the documents could not be read')
		const project = projectOver({ [name]: store })
		expect(await rejectionKey({ action: project.open(name) })).toBe(
			'Error: the documents could not be read',
		)
		expect(store.closeCalls).toBe(1)
		expect(await rejectionKey({ action: project.getDocuments() })).toBe('PROJECT_NOT_OPENED')
		await project.destroy()
		expect(store.destroys).toBe(1)
	})
})
