import {
	contractFile,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
	sessionRecords,
} from '../contract/store-contract.fixtures'
import { createInProcessConnector } from '../sqlite/adapter/in-process-link'
import { EngineStore } from './engine-store'
import { INNER_MEMBERS } from './engine-store.fixtures.constants'
import { ENGINE_WIRE_MEMBERS } from './wire/wire.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { StoreNotice, WriteOutcome } from '../store.types'
import type { EngineLostReason } from './client/client.types'
import type {
	CallLog,
	GatedCall,
	GatedConnector,
	GatedDestroy,
	InnerMember,
	MemberActs,
	StoreState,
} from './engine-store.fixtures.types'
import type { EngineConnector, LinkNotice } from './engine-store.types'
import type { EngineApi } from './engine.types'
import type { WireMemberSpec } from './wire/wire.types'

/** The names a case used: destroyed after it, whatever state its stores were left in. */
const usedNames: string[] = []
/** The stores a case made: closed after it, so that no connection keeps its project from being destroyed. */
const madeStores: EngineStore[] = []

afterEach(async () => {
	for (const store of madeStores.splice(0)) store.close()
	for (const name of usedNames.splice(0)) await openStore({ name }).destroy()
})

function openStore(params: { name: string }): EngineStore {
	const { name } = params
	const store = new EngineStore({
		name,
		connector: createInProcessConnector({ name, dialecteId: TEST_DIALECTE.id }),
	})
	madeStores.push(store)
	return store
}

/** An open store of a name of its own, holding `doc-1` with record `r1`. */
async function seededStore(): Promise<EngineStore> {
	const name = `engine-store-${crypto.randomUUID()}`
	usedNames.push(name)
	const store = openStore({ name })
	await store.open()
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
	return store
}

describe('EngineStore', () => {
	it('a store opened twice then closed → the engine closes with it: the next store of the name starts it again', async () => {
		const store = await seededStore()
		await store.registerDocument(makeDocument({ id: 'left', status: 'importing' }))
		await store.open()
		store.close()
		const next = openStore({ name: store.name })
		await next.open()
		// an engine start removes what an import left unfinished: it ran
		expect((await next.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
	})

	it('a connection released → it reaches no engine: STORE_CLOSED', async () => {
		const store = await seededStore()
		store.close()
		const connector = createInProcessConnector({ name: store.name, dialecteId: TEST_DIALECTE.id })
		const link = await connector.connect()
		link.close()
		await expectRejectsWith({ action: link.engine(), key: 'STORE_CLOSED' })
	})

	it('a store with no dialecte asked an import with a signal already aborted → IMPORT_FAILED, as every store answers', async () => {
		const store = await seededStore()
		await expectRejectsWith({
			action: store.importFile({
				file: contractFile({ body: sessionRecords(1) }),
				signal: AbortSignal.abort(),
			}),
			key: 'IMPORT_FAILED',
		})
		expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
	})
})

/**
 * A connector over the in-process engine whose engine is lost (`reason`) the first `losses` times a call
 * of `member` reaches it - as a host gone, or an engine gone silent, refuses its calls in flight. Each
 * engine the link hands out counts as a new one.
 */
function losingConnector(params: {
	name: string
	member: keyof EngineApi
	reason: EngineLostReason
	losses?: number
	calls: CallLog
}): EngineConnector {
	const { name, member, reason, calls } = params
	let lossesLeft = params.losses ?? 1
	let engines = 0
	const inner = createInProcessConnector({ name, dialecteId: TEST_DIALECTE.id })
	function lostError(): Error {
		return createDialecteError('STORE_ENGINE_LOST', {
			detail: 'the engine was lost while the call waited',
			meta: { reason },
		})
	}
	return {
		destroy: inner.destroy,
		connect: async function connectLosing() {
			const link = await inner.connect()
			return {
				close: link.close,
				connectionId: link.connectionId,
				onNotice: link.onNotice,
				engine: async function losingEngine() {
					const engine = await link.engine()
					engines += 1
					const handed = engines
					const members = Object.keys(ENGINE_WIRE_MEMBERS) as (keyof EngineApi)[]
					return Object.fromEntries(
						members.map(function wrapMember(called) {
							return [
								called,
								function callOrLose(...args: unknown[]) {
									const lost = called === member && lossesLeft > 0
									calls.push({ member: called, lost, engine: handed })
									if (!lost) return (engine[called] as (...args: unknown[]) => unknown)(...args)
									lossesLeft -= 1
									return Promise.reject(lostError())
								},
							]
						}),
					) as unknown as EngineApi
				},
			}
		},
	}
}

/**
 * A store of its own name whose engine loses the first call(s) of `member`, seeded so every write changes
 * what `stateOf` reads: `doc-1` with records `r1` and `r2` (`r3` committed then undone: a history both
 * ways), and `blob-1` attached to `r1`.
 */
async function losingStore(params: {
	member: keyof EngineApi
	reason: EngineLostReason
	losses?: number
}): Promise<{ store: EngineStore; calls: CallLog }> {
	const seeded = await seededStore()
	// something for every write to change - a history both ways, a blob - so a write marked a read moves the state
	for (const id of ['r2', 'r3']) {
		await seeded.commit({
			documentId: 'doc-1',
			creates: [makeRecord({ id })],
			updates: [],
			deletes: [],
			onProgress: ignoreProgress,
		})
	}
	await seeded.undo('doc-1')
	await seeded.addBlob(makeBlobEntry({ id: 'blob-1', documentId: 'doc-1' }), new Blob(['x']))
	await seeded.attachBlob('blob-1', { documentId: 'doc-1', recordRef: 'r1' })
	seeded.close()
	const calls: CallLog = []
	const store = new EngineStore({
		name: seeded.name,
		connector: losingConnector({ name: seeded.name, calls, ...params }),
	})
	madeStores.push(store)
	await store.open()
	return { store, calls }
}

function callsOf(params: { calls: CallLog; member: keyof EngineApi }): number {
	return enginesReached(params).length
}

/** The engines the calls of `member` reached, in order. */
function enginesReached(params: { calls: CallLog; member: keyof EngineApi }): number[] {
	return params.calls
		.filter(function isOfMember(call) {
			return call.member === params.member
		})
		.map(function engineOf(call) {
			return call.engine
		})
}

/** Every member the store calls itself, as that call - one per member: a member added to the engine fails the type check here. */
const MEMBER_ACTS: MemberActs = {
	registerDocument: function registerDocument(store) {
		return store.registerDocument(makeDocument({ id: 'doc-2' }))
	},
	getDocument: function getDocument(store) {
		return store.getDocument('doc-1')
	},
	getDocuments: function getDocuments(store) {
		return store.getDocuments()
	},
	updateDocument: function updateDocument(store) {
		return store.updateDocument('doc-1', { name: 'renamed.xml' })
	},
	removeDocument: function removeDocument(store) {
		return store.removeDocument('doc-1')
	},
	get: function get(store) {
		return store.get('r1', 'doc-1')
	},
	getByDocumentId: function getByDocumentId(store) {
		return store.getByDocumentId('doc-1')
	},
	count: function count(store) {
		return store.count('doc-1')
	},
	getByTagNameInDocument: function getByTagNameInDocument(store) {
		return store.getByTagNameInDocument('A', 'doc-1')
	},
	getMany: function getMany(store) {
		return store.getMany(['r1'], 'doc-1')
	},
	bulkWrite: function bulkWrite(store) {
		return store.bulkWrite('doc-1', { deletes: ['r1'] })
	},
	getWriteOutcome: function getWriteOutcome(store) {
		return store.getWriteOutcome({ writeId: 'w-asked' })
	},
	undo: function undo(store) {
		return store.undo('doc-1')
	},
	redo: function redo(store) {
		return store.redo('doc-1')
	},
	getHistoryStatus: function getHistoryStatus(store) {
		return store.getHistoryStatus('doc-1')
	},
	getChangeLog: function getChangeLog(store) {
		return store.getChangeLog('doc-1')
	},
	commit: function commit(store) {
		return store.commit({
			documentId: 'doc-1',
			creates: [makeRecord({ id: 'r9' })],
			updates: [],
			deletes: [],
			onProgress: ignoreProgress,
		})
	},
	importFile: function importFile(store) {
		return store.importFile({ file: new File(['<A/>'], 'a.xml'), writeId: 'w-lost' })
	},
	exportFile: function exportFile(store) {
		return store.exportFile({ documentId: 'doc-1' })
	},
	addBlob: function addBlob(store) {
		return store.addBlob(makeBlobEntry({ id: 'blob-2', documentId: 'doc-1' }), new Blob(['y']))
	},
	getBlob: function getBlob(store) {
		return store.getBlob('blob-1')
	},
	getBlobsByDocument: function getBlobsByDocument(store) {
		return store.getBlobsByDocument('doc-1')
	},
	getBlobsByRecord: function getBlobsByRecord(store) {
		return store.getBlobsByRecord('doc-1', 'r1')
	},
	getStandaloneBlobs: function getStandaloneBlobs(store) {
		return store.getStandaloneBlobs()
	},
	attachBlob: function attachBlob(store) {
		return store.attachBlob('blob-1', { documentId: 'doc-1', recordRef: 'r2' })
	},
	detachBlob: function detachBlob(store) {
		return store.detachBlob('blob-1', { documentId: 'doc-1', recordRef: 'r1' })
	},
	removeBlob: function removeBlob(store) {
		return store.removeBlob('blob-1')
	},
}

function ignoreProgress(): void {}

function isInnerMember(member: keyof EngineApi): member is InnerMember {
	return (INNER_MEMBERS as readonly string[]).includes(member)
}

/** The store's state through a connection of its own (not the losing one): documents, records, history, blobs. */
async function stateOf(params: { name: string }): Promise<StoreState> {
	const store = openStore({ name: params.name })
	try {
		return {
			documents: await store.getDocuments(),
			records: await store.getByDocumentId('doc-1'),
			changeLog: await store.getChangeLog('doc-1'),
			history: await store.getHistoryStatus('doc-1'),
			blobs: await store.getBlobsByDocument('doc-1'),
			blobsThere: [
				(await store.getBlob('blob-1')) !== undefined,
				(await store.getBlob('blob-2')) !== undefined,
			],
			attachments: [
				await store.getBlobsByRecord('doc-1', 'r1'),
				await store.getBlobsByRecord('doc-1', 'r2'),
			],
		}
	} finally {
		store.close()
	}
}

function idOf(document: { id: string }): string {
	return document.id
}

describe('EngineStore, an engine lost while a call waited', () => {
	for (const member of Object.keys(ENGINE_WIRE_MEMBERS) as (keyof EngineApi)[]) {
		if (isInnerMember(member)) continue
		const act = MEMBER_ACTS[member]
		const spec: WireMemberSpec = ENGINE_WIRE_MEMBERS[member]
		if (spec.read) {
			it(`${member}, a read, lost with its host → made once more, on the next engine; the store unchanged`, async () => {
				const { store, calls } = await losingStore({ member, reason: 'host-gone' })
				const before = await stateOf({ name: store.name })
				await act(store)
				const reached = enginesReached({ calls, member })
				expect(reached).toHaveLength(2)
				expect(reached[1]).toBeGreaterThan(reached[0] ?? Infinity)
				// made again on another engine, it must only read: nothing of the store moved
				const after = await stateOf({ name: store.name })
				expect(after).toEqual(before)
				store.close()
			})
			continue
		}
		it(`${member}, not a read, lost with its host → refused STORE_ENGINE_LOST, not made again`, async () => {
			const { store, calls } = await losingStore({ member, reason: 'host-gone' })
			await expectRejectsWith({ action: act(store), key: 'STORE_ENGINE_LOST' })
			expect(callsOf({ calls, member })).toBe(1)
			store.close()
		})
	}

	it('a read lost with its host → answered by the next engine', async () => {
		const { store } = await losingStore({ member: 'getDocuments', reason: 'host-gone' })
		const documents = await store.getDocuments()
		expect(documents.map(idOf)).toEqual(['doc-1'])
		store.close()
	})

	it('a read lost with its host twice → refused STORE_ENGINE_LOST after its one retry', async () => {
		const { store, calls } = await losingStore({ member: 'get', reason: 'host-gone', losses: 2 })
		await expectRejectsWith({ action: store.get('r1', 'doc-1'), key: 'STORE_ENGINE_LOST' })
		expect(callsOf({ calls, member: 'get' })).toBe(2)
		store.close()
	})

	it('a read lost to a silent engine → refused, not retried (the engine may still be running)', async () => {
		const { store, calls } = await losingStore({ member: 'count', reason: 'no-heartbeat' })
		await expectRejectsWith({ action: store.count('doc-1'), key: 'STORE_ENGINE_LOST' })
		expect(callsOf({ calls, member: 'count' })).toBe(1)
		store.close()
	})
})

function gatedConnector(params: { destroy: GatedDestroy }): GatedConnector {
	let openLinks = 0
	let connects = 0
	let destroys = 0
	let destroysRunning = 0
	let mostDestroysAtOnce = 0
	const held: { connect?: Promise<void>; destroy?: Promise<void> } = {}
	function takeHold({ call }: { call: GatedCall }): Promise<void> {
		const hold = held[call] ?? Promise.resolve()
		held[call] = undefined
		return hold
	}
	return {
		connector: {
			connect: async function connectGated() {
				connects += 1
				await takeHold({ call: 'connect' })
				openLinks += 1
				let closed = false
				return {
					connectionId: 'held',
					onNotice: listenToNothing,
					engine: async function noEngine() {
						if (closed)
							throw createDialecteError('STORE_CLOSED', { detail: 'the link was released' })
						return {} as EngineApi
					},
					close: async function closeLink() {
						if (closed) return
						closed = true
						openLinks -= 1
					},
				}
			},
			destroy: async function destroyGated(destroyParams) {
				destroys += 1
				destroysRunning += 1
				mostDestroysAtOnce = Math.max(mostDestroysAtOnce, destroysRunning)
				try {
					await takeHold({ call: 'destroy' })
				} finally {
					destroysRunning -= 1
				}
				if (params.destroy === 'refuse') {
					throw createDialecteError('PROJECT_OPEN_ELSEWHERE', {
						detail: 'another connection is open',
					})
				}
				// gone ahead: the store's own link let go, then the files not removed
				destroyParams?.own?.letGo()
				throw createDialecteError('PROJECT_DESTROY_FAILED', { detail: 'the files are still there' })
			},
		},
		openLinks: function countOpenLinks() {
			return openLinks
		},
		asked: function countAsked() {
			return { connects, destroys }
		},
		mostDestroysAtOnce: function countMostDestroysAtOnce() {
			return mostDestroysAtOnce
		},
		holdNext: function holdNext({ call }) {
			let letGo: () => void = function noHoldYet() {}
			held[call] = new Promise<void>(function holdUntilLetGo(resolve) {
				letGo = resolve
			})
			return letGo
		},
	}
}

describe('EngineStore, the changes it tells', () => {
	/** A link whose engine refuses every commit lost (its writeId on the refusal) and whose notices the case sends. */
	function lostCommitConnector(params: { outcome?: WriteOutcome } = {}): {
		connector: EngineConnector
		tell: (notice: LinkNotice) => void
	} {
		const { outcome = 'running' } = params
		let told: (notice: LinkNotice) => void = function nobody() {}
		const connector: EngineConnector = {
			connect: async function connectLosing() {
				return {
					connectionId: 'own-connection',
					onNotice: function listen(listener) {
						told = listener
						return function stopListening() {}
					},
					engine: async function losingEngine() {
						return {
							commit: async function lose(params: { writeId: string }) {
								throw createDialecteError('STORE_ENGINE_LOST', {
									detail: 'lost while it waited',
									meta: { reason: 'no-heartbeat', writeId: params.writeId },
								})
							},
							getWriteOutcome: async function answerOutcome() {
								return outcome
							},
						} as unknown as EngineApi
					},
					close: async function release() {},
				}
			},
			destroy: async function destroyNothing() {},
		}
		return {
			connector,
			tell: function tellStore(notice) {
				told(notice)
			},
		}
	}

	function commitEvent(params: { writeId: string; connectionId: string }): LinkNotice {
		return {
			type: 'event',
			signal: {
				type: 'event',
				message: { type: 'commit', documentId: 'doc-1', timestamp: 1 },
				...params,
			},
		}
	}

	it('its own commit refused lost, then told landed → told as another connection’s (its caller saw it fail); its other own changes as its own', async () => {
		const { connector, tell } = lostCommitConnector()
		const store = new EngineStore({ name: `told-${crypto.randomUUID()}`, connector })
		const notices: StoreNotice[] = []
		store.subscribe(function keep(notice) {
			notices.push(notice)
		})
		await store.open()
		await expectRejectsWith({
			action: store.commit({
				documentId: 'doc-1',
				writeId: 'w-lost',
				creates: [],
				updates: [],
				deletes: [],
				onProgress: function ignoreProgress() {},
			}),
			key: 'STORE_ENGINE_LOST',
		})
		tell(commitEvent({ writeId: 'w-lost', connectionId: 'own-connection' }))
		// told as another's once: the same id again is its own
		tell(commitEvent({ writeId: 'w-lost', connectionId: 'own-connection' }))
		tell(commitEvent({ writeId: 'w-kept', connectionId: 'own-connection' }))
		tell(commitEvent({ writeId: 'w-other', connectionId: 'other-connection' }))
		tell({ type: 'resync' })
		expect(
			notices.map(function shape(notice) {
				return notice.type === 'resync' ? 'resync' : notice.own
			}),
		).toEqual([false, true, true, false, 'resync'])
		await store.close()
	})

	type ForgottenCase = {
		outcome?: WriteOutcome
		/** What follows the lost commit before its change is told. */
		then: (params: { store: EngineStore; tell: (notice: LinkNotice) => void }) => Promise<unknown>
		toldAsOwn: boolean
	}
	const forgottenCases: Record<string, ForgottenCase> = {
		'its outcome asked, not applied → its id forgotten (a change of that id told as its own)': {
			outcome: 'not-applied',
			then: function askOutcome({ store }) {
				return store.getWriteOutcome({ writeId: 'w-lost' })
			},
			toldAsOwn: true,
		},
		'its outcome asked, applied → its id forgotten (its change came before that answer, or never comes)':
			{
				outcome: 'applied',
				then: function askOutcome({ store }) {
					return store.getWriteOutcome({ writeId: 'w-lost' })
				},
				toldAsOwn: true,
			},
		'its outcome asked, still running → its id kept (its change, when it lands, told as another’s)':
			{
				outcome: 'running',
				then: function askOutcome({ store }) {
					return store.getWriteOutcome({ writeId: 'w-lost' })
				},
				toldAsOwn: false,
			},
		'a resync told (another engine: the lost one’s change never comes) → its id forgotten': {
			then: async function resync({ tell }) {
				tell({ type: 'resync' })
			},
			toldAsOwn: true,
		},
		'the store closed and opened again → its id forgotten': {
			then: async function closeAndOpen({ store }) {
				await store.close()
				await store.open()
			},
			toldAsOwn: true,
		},
	}
	for (const [description, { outcome, then, toldAsOwn }] of Object.entries(forgottenCases)) {
		it(`its own commit refused lost, then ${description}`, async () => {
			const { connector, tell } = lostCommitConnector({ outcome })
			const store = new EngineStore({ name: `forgotten-${crypto.randomUUID()}`, connector })
			const changes: boolean[] = []
			store.subscribe(function keep(notice) {
				if (notice.type === 'change') changes.push(notice.own)
			})
			await store.open()
			await expectRejectsWith({
				action: store.commit({
					documentId: 'doc-1',
					writeId: 'w-lost',
					creates: [],
					updates: [],
					deletes: [],
					onProgress: function ignoreProgress() {},
				}),
				key: 'STORE_ENGINE_LOST',
			})
			await then({ store, tell })
			tell(commitEvent({ writeId: 'w-lost', connectionId: 'own-connection' }))
			expect(changes).toEqual([toldAsOwn])
			await store.close()
		})
	}

	it('its last listener gone → it listens to its link no more (a link listened to follows its next engine); a new one → again', async () => {
		let listening = 0
		const connector: EngineConnector = {
			connect: async function connectCounted() {
				return {
					connectionId: 'counted',
					onNotice: function listen() {
						listening += 1
						return function stopListening() {
							listening -= 1
						}
					},
					engine: async function noEngine() {
						return {} as EngineApi
					},
					close: async function release() {},
				}
			},
			destroy: async function destroyNothing() {},
		}
		const store = new EngineStore({ name: `listened-${crypto.randomUUID()}`, connector })
		await store.open()
		expect(listening).toBe(0)
		const first = store.subscribe(function first() {})
		const second = store.subscribe(function second() {})
		expect(listening).toBe(1)
		first()
		expect(listening).toBe(1)
		second()
		expect(listening).toBe(0)
		store.subscribe(function third() {})
		expect(listening).toBe(1)
		await store.close()
		expect(listening).toBe(0)
	})
})

describe('EngineStore, a destroy refused', () => {
	it('its link kept as it was: never released, never made again; the store closed → none left open', async () => {
		const gated = gatedConnector({ destroy: 'refuse' })
		const store = new EngineStore({
			name: `engine-store-${crypto.randomUUID()}`,
			connector: gated.connector,
		})
		await store.open()

		await expectRejectsWith({ action: store.destroy(), key: 'PROJECT_OPEN_ELSEWHERE' })

		expect(gated.asked().connects).toBe(1)
		expect(gated.openLinks()).toBe(1)
		store.close()
		expect(gated.openLinks()).toBe(0)
	})

	it('destroyed twice at once → the second destroy asks once the first has ended', async () => {
		const gated = gatedConnector({ destroy: 'refuse' })
		const store = new EngineStore({
			name: `engine-store-${crypto.randomUUID()}`,
			connector: gated.connector,
		})
		await store.open()
		const letDestroyGo = gated.holdNext({ call: 'destroy' })
		const first = store.destroy().catch(() => undefined)
		await vi.waitFor(() => {
			expect(gated.asked().destroys).toBe(1)
		})
		const second = store.destroy().catch(() => undefined)
		// long enough for a second destroy that does not wait to reach the connector
		await new Promise(function letTheSecondDestroyAsk(resolve) {
			setTimeout(resolve, 50)
		})
		letDestroyGo()
		await Promise.all([first, second])

		expect(gated.asked().destroys).toBe(2)
		expect(gated.mostDestroysAtOnce()).toBe(1)
		store.close()
		expect(gated.openLinks()).toBe(0)
	})
})

describe('EngineStore, a destroy gone ahead, then failed', () => {
	it('its link let go → the next operation connects again', async () => {
		const gated = gatedConnector({ destroy: 'fail-gone-ahead' })
		const store = new EngineStore({
			name: `engine-store-${crypto.randomUUID()}`,
			connector: gated.connector,
		})
		await store.open()

		await expectRejectsWith({ action: store.destroy(), key: 'PROJECT_DESTROY_FAILED' })
		await store.reconcile()

		expect(gated.asked().connects).toBe(2)
		expect(gated.openLinks()).toBe(1)
		store.close()
	})
})

describe('EngineStore, closed twice', () => {
	it('the second close → settled with the first one’s release of the link, never before it', async () => {
		let letGo: () => void = settleNothing
		const linkReleased = new Promise<void>(function waitForRelease(resolve) {
			letGo = resolve
		})
		const connector: EngineConnector = {
			connect: async function connectHeld() {
				return {
					connectionId: 'held',
					onNotice: listenToNothing,
					engine: async function noEngine() {
						return {} as EngineApi
					},
					close: function releaseHeld() {
						return linkReleased
					},
				}
			},
			destroy: async function destroyNothing() {},
		}
		const store = new EngineStore({ name: `closed-twice-${crypto.randomUUID()}`, connector })
		await store.open()
		const settled: string[] = []
		void store.close().then(function firstSettled() {
			settled.push('first')
		})
		void store.close().then(function secondSettled() {
			settled.push('second')
		})
		await new Promise(function afterTimers(resolve) {
			setTimeout(resolve, 0)
		})
		expect(settled).toEqual([])
		letGo()
		await vi.waitFor(function bothSettled() {
			expect(settled).toEqual(['first', 'second'])
		})
	})
})

function settleNothing(): void {}

/** A link that announces nothing: its unsubscribe does nothing either. */
function listenToNothing(): () => void {
	return function stopNothing() {}
}
