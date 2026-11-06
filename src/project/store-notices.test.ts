import { Project } from './project'
import { CHANGES_HELD_MAX } from './project.constants'

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createDialecteError, toDialecteError } from '@/errors'
import { InMemoryStore } from '@/store'
import { commit, makeRecord } from '@/store/contract/store-contract.fixtures'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'
import { quietReports, reportedFailures } from '@/utils/tell-listener.fixtures'

import type { Store, StoreNotice } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

/** The stores a case made: destroyed after it. */
const made: Store[] = []

afterEach(async () => {
	for (const store of made.splice(0)) await store.destroy()
})

/**
 * An in-memory store whose notices the case sends itself (`tell`): what the store says of its changes is held back,
 * so the project learns only what the case tells it.
 */
function toldStore(params: { name: string }): {
	store: Store
	tell: (notice: StoreNotice) => void
} {
	const store = new InMemoryStore(params.name, { runtime: RUNTIME })
	let told: (notice: StoreNotice) => void = function nobody() {}
	store.subscribe = function captureListener(listener) {
		told = listener
		return function stopListening() {}
	}
	return {
		store,
		tell: function tellProject(notice) {
			told(notice)
		},
	}
}

describe('a project told by its store', () => {
	it('to read again (resync) → the documents written meanwhile in its state, each document’s view woken, its channel’s listeners told to read again', async () => {
		const name = `notices-${crypto.randomUUID()}`
		const { store, tell } = toldStore({ name })
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open(name)
		const { documentId: seen } = await project.importFile(
			new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'seen.xml'),
		)
		let woken = 0
		project.openDocument(seen).subscribe(function wake() {
			woken += 1
		})
		// written by another store of the project, its change never told to this one
		const elsewhere = new InMemoryStore(name, { runtime: RUNTIME })
		made.push(elsewhere)
		await elsewhere.open()
		const { record } = await elsewhere.importFile({
			file: new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'unseen.xml'),
		})
		await elsewhere.close()
		expect(project.state.documents.has(record.id)).toBe(false)
		const heard = listenTo({ project })

		tell({ type: 'resync' })

		await vi.waitFor(function readAgain() {
			expect(project.state.documents.has(record.id)).toBe(true)
			expect(woken).toBeGreaterThan(0)
			expect(heard).toEqual(['resync -'])
		})
		await project.close()
	})

	/** An in-memory store counting the listeners subscribed to it and not let go; `refuseOpen` fails its open. */
	function countedStore(params: { name: string; refuseOpen?: boolean }): {
		store: Store
		listening: () => number
	} {
		const store = new InMemoryStore(params.name, { runtime: RUNTIME })
		const subscribe = store.subscribe.bind(store)
		let listening = 0
		store.subscribe = function countListener(listener) {
			listening += 1
			const stop = subscribe(listener)
			return function stopCounted() {
				listening -= 1
				stop()
			}
		}
		if (params.refuseOpen) {
			store.open = async function refuseOpen() {
				throw new Error('refused')
			}
		}
		return {
			store,
			listening: function count() {
				return listening
			},
		}
	}

	type ListenCase = {
		act: (params: { name: string }) => Promise<{ listening: () => number; expected: number }>
	}
	const listenCases: Record<string, ListenCase> = {
		'closed → its store no longer listened to': {
			act: async function closed({ name }) {
				const { store, listening } = countedStore({ name })
				made.push(store)
				const project = await new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				}).open(name)
				await project.close()
				return { listening, expected: 0 }
			},
		},
		'its open refused by its store → that store no longer listened to': {
			act: async function refused({ name }) {
				const { store, listening } = countedStore({ name, refuseOpen: true })
				const project = new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				})
				await expect(project.open(name)).rejects.toThrow('refused')
				return { listening, expected: 0 }
			},
		},
		'opened again under another name → one store listened to': {
			act: async function reopened({ name }) {
				const { store, listening } = countedStore({ name })
				made.push(store)
				const project = new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				})
				await project.open(name)
				await project.open(`${name}-again`)
				const count = listening()
				await project.close()
				return { listening: () => count, expected: 1 }
			},
		},
	}
	for (const [description, { act }] of Object.entries(listenCases)) {
		it(description, async () => {
			const { listening, expected } = await act({ name: `notices-${crypto.randomUUID()}` })
			expect(listening()).toBe(expected)
		})
	}
})

/** What a listener of the project's channel heard, as `<type> <documentId>`; its channel closed after the case. */
function listenTo(params: { project: Project<AnyDialecteConfig> }): string[] {
	const heard: string[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function hear(event: MessageEvent<{ type: string; documentId?: string }>) {
		heard.push(`${event.data.type} ${event.data.documentId ?? '-'}`)
	}
	onTestFinished(function closeChannel() {
		channel.close()
	})
	return heard
}

/** A project open on an in-memory store the case holds too (a `custom` storage), one document imported. */
async function openHeld(): Promise<{
	project: Project<AnyDialecteConfig>
	store: Store
	documentId: string
}> {
	const name = `held-${crypto.randomUUID()}`
	const store = new InMemoryStore(name, { runtime: RUNTIME })
	made.push(store)
	const project = await new Project({
		configs: { default: CONFIG },
		storage: { type: 'custom', store },
	}).open(name)
	onTestFinished(function closeProject() {
		return project.close()
	})
	const { documentId } = await project.importFile(
		new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'held.xml'),
	)
	return { project, store, documentId }
}

describe('a change of the project’s own store that no Project call made (the store held directly)', () => {
	it('a document renamed on the store → posted once to the listeners, the project’s record read again', async () => {
		const { project, store, documentId } = await openHeld()
		const heard = listenTo({ project })
		await store.updateDocument(documentId, { name: 'renamed' })
		await vi.waitFor(function postedAndRead() {
			expect(heard).toEqual([`document-updated ${documentId}`])
			expect(project.state.documents.get(documentId)?.record.name).toBe('renamed')
		})
		// a later call of the Project's posts its own change only
		await project.initEmptyDocument()
		await vi.waitFor(function laterPosted() {
			expect(
				heard.filter(function isUpdate(line) {
					return line.startsWith('document-updated')
				}),
			).toHaveLength(1)
			expect(heard.length).toBeGreaterThan(1)
		})
	})

	it(`more than ${CHANGES_HELD_MAX} such changes while a Project call runs → posted before the call ends`, async () => {
		const { project, store, documentId } = await openHeld()
		const heard = listenTo({ project })
		let release: () => void = function notYet() {}
		const gate = new Promise<void>(function hold(resolve) {
			release = resolve
		})
		const running = project.openDocument(documentId).transaction(async function heldOpen() {
			await gate
		})
		for (let index = 0; index <= CHANGES_HELD_MAX; index += 1) {
			await store.updateDocument(documentId, { name: `name-${index}` })
		}
		await vi.waitFor(function postedWhileRunning() {
			expect(heard.length).toBeGreaterThan(CHANGES_HELD_MAX)
		})
		release()
		await running
		// each posted once: none again with the call's end
		await project.initEmptyDocument()
		await vi.waitFor(function eachOnce() {
			expect(
				heard.filter(function isUpdate(line) {
					return line.startsWith('document-updated')
				}),
			).toHaveLength(CHANGES_HELD_MAX + 1)
			expect(
				heard.some(function isNew(line) {
					return line.startsWith('init-empty-document')
				}),
			).toBe(true)
		})
	})

	it(`more than ${CHANGES_HELD_MAX} such changes (commits, whose fold wakes the Document) while a call runs, a Document’s subscriber throwing at one → every one posted all the same`, async () => {
		const { project, store, documentId } = await openHeld()
		const heard = listenTo({ project })
		let thrown = false
		project.openDocument(documentId).subscribe(function failOnce(terminal) {
			// a commit folded wakes the Document's subscribers (terminal); the transaction's start does not
			if (thrown || !terminal) return
			thrown = true
			throw new Error('a subscriber failing')
		})
		// the subscriber's failure is reported: quiet here, its report is another case's
		const reported = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
		onTestFinished(function restoreConsole() {
			reported.mockRestore()
		})
		let release: () => void = function notYet() {}
		const gate = new Promise<void>(function hold(resolve) {
			release = resolve
		})
		const running = project.openDocument(documentId).transaction(async function heldOpen() {
			await gate
		})
		for (let index = 0; index <= CHANGES_HELD_MAX; index += 1) {
			await store.bulkWrite(documentId, { creates: [makeRecord({ id: `r-${index}` })] })
		}
		await vi.waitFor(function allPosted() {
			expect(
				heard.filter(function isCommit(line) {
					return line.startsWith('commit')
				}),
			).toHaveLength(CHANGES_HELD_MAX + 1)
		})
		release()
		await running.catch(function failedByTheSubscriber() {})
	})

	it('a change told while a removal runs, a subscriber of its document throwing as the removal posts it → the removal resolves, posted after it, the failure reported', async () => {
		const { project, store, documentId: other } = await openHeld()
		const removed = await project.initEmptyDocument()
		const heard = listenTo({ project })
		const failure = new Error('a subscriber failing')
		project.openDocument(other).subscribe(function failAtTheFold(terminal) {
			if (terminal) throw failure
		})
		const reported = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
		onTestFinished(function restoreConsole() {
			reported.mockRestore()
		})
		let release: () => void = function notYet() {}
		const gate = new Promise<void>(function hold(resolve) {
			release = resolve
		})
		const removeDocument = store.removeDocument.bind(store)
		store.removeDocument = async function heldRemoval(documentId) {
			await gate
			return removeDocument(documentId)
		}
		const removing = project.removeDocument(removed)
		await store.bulkWrite(other, { creates: [makeRecord({ id: 'r-other' })] })
		release()
		await removing
		await vi.waitFor(function bothPosted() {
			expect(heard).toEqual([`commit ${other}`, `document-removed ${removed}`])
		})
		expect(reported.mock.calls).toEqual([
			[
				`Project "${project.name}": folding in a change of its store (commit) failed; the other changes are folded in all the same:`,
				failure,
			],
		])
	})

	type FailingCallCase = {
		/** The call, held on `gate` once it runs, then failing; the store wrapped first when the call fails there. */
		call: (params: {
			project: Project<AnyDialecteConfig>
			store: Store
			documentId: string
			gate: Promise<void>
		}) => Promise<unknown>
	}
	const failingCalls: Record<string, FailingCallCase> = {
		'a transaction whose callback throws': {
			call: function failingTransaction({ project, documentId, gate }) {
				return project.openDocument(documentId).transaction(async function heldThenFailing() {
					await gate
					throw new Error('cancelled by the user')
				})
			},
		},
		'a removal its store refuses': {
			call: function failingRemoval({ project, store, gate }) {
				store.removeDocument = async function heldThenRefused() {
					await gate
					throw new Error('refused by the store')
				}
				return project.removeDocument('another-document')
			},
		},
		'an import its store refuses': {
			call: function failingImport({ project, store, gate }) {
				store.importFile = async function heldThenRefused() {
					await gate
					throw new Error('refused by the store')
				}
				return project.importFile(new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'refused.xml'))
			},
		},
	}
	for (const [description, { call }] of Object.entries(failingCalls)) {
		it(`such a change told while ${description} runs, the call then failing (it posts nothing) → posted once the call ended`, async () => {
			const { project, store, documentId } = await openHeld()
			const heard = listenTo({ project })
			let release: () => void = function notYet() {}
			const gate = new Promise<void>(function hold(resolve) {
				release = resolve
			})
			const failing = call({ project, store, documentId, gate })
			await store.updateDocument(documentId, { name: 'renamed' })
			release()
			await failing.catch(function failedAsMeant() {})
			await vi.waitFor(function postedAfterTheCall() {
				expect(heard).toEqual([`document-updated ${documentId}`])
				expect(project.state.documents.get(documentId)?.record.name).toBe('renamed')
			})
		})
	}
})

type FoldFailureCase = {
	/** The change made, as the project's store tells it. */
	told: string
	change: (params: { store: Store; documentId: string }) => Promise<void>
}
const foldFailureCases: Record<string, FoldFailureCase> = {
	'a rename on the store it holds (its record read again, no call awaiting it)': {
		told: 'document-updated',
		change: function renamed({ store, documentId }) {
			return store.updateDocument(documentId, { name: 'renamed' })
		},
	},
	'a commit of another connection to the project (folded as it is told)': {
		told: 'commit',
		change: async function committedElsewhere({ store, documentId }) {
			const elsewhere = new InMemoryStore(store.name, { runtime: RUNTIME })
			await elsewhere.open()
			await elsewhere.bulkWrite(documentId, { creates: [makeRecord({ id: 'r-elsewhere' })] })
			await elsewhere.close()
		},
	},
}

describe('a change of the project’s store folded in, a Document’s subscriber throwing', () => {
	for (const [description, { told, change }] of Object.entries(foldFailureCases)) {
		it(`${description} → reported on the console, the next change folded all the same`, async () => {
			const { project, store, documentId } = await openHeld()
			const failure = new Error('a subscriber failing')
			let failed = false
			project.openDocument(documentId).subscribe(function failOnce(terminal) {
				if (!terminal || failed) return
				failed = true
				throw failure
			})
			const reported = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
			onTestFinished(function restoreConsole() {
				reported.mockRestore()
			})
			await change({ store, documentId })
			await vi.waitFor(function reportedOnce() {
				expect(reported.mock.calls).toEqual([
					[
						`Project "${project.name}": folding in a change of its store (${told}) failed; the other changes are folded in all the same:`,
						failure,
					],
				])
			})
			await store.updateDocument(documentId, { name: 'renamed again' })
			await vi.waitFor(function foldedAgain() {
				expect(project.state.documents.get(documentId)?.record.name).toBe('renamed again')
			})
		})
	}
})

type OpeningCase = {
	/** The store wrapped so that `rename` runs inside its open, at the moment the case names. */
	wrap: (params: { store: Store; rename: () => Promise<void> }) => void
}
const openingCases: Record<string, OpeningCase> = {
	'as the store opens (its cleanup of an unfinished import)': {
		wrap: function renameInOpen({ store, rename }) {
			const opened = store.open.bind(store)
			store.open = async function renamedWhileOpening() {
				await opened()
				await rename()
			}
		},
	},
	'as the project reads its documents, after the store answered them': {
		wrap: function renameAfterRead({ store, rename }) {
			const opened = store.open.bind(store)
			store.open = async function readThenRenamed() {
				await opened()
				// the project's own read, once the store opened (its open reads the documents too)
				const read = store.getDocuments.bind(store)
				store.getDocuments = async function renamedOnceRead() {
					store.getDocuments = read
					const documents = await read()
					await rename()
					return documents
				}
			}
		},
	},
}

describe('a change of the project’s own store told while it opens (the store held directly)', () => {
	for (const [description, { wrap }] of Object.entries(openingCases)) {
		it(`${description} → folded and posted as the open settles, not held for a later change`, async () => {
			const { project: first, store, documentId } = await openHeld()
			await first.close()
			wrap({
				store,
				rename: function renameDocument() {
					return store.updateDocument(documentId, { name: 'renamed while opening' })
				},
			})
			const project = await new Project({
				configs: { default: CONFIG },
				storage: { type: 'custom', store },
			}).open(store.name)
			onTestFinished(function closeProject() {
				return project.close()
			})
			await vi.waitFor(function readAgain() {
				expect(project.state.documents.get(documentId)?.record.name).toBe('renamed while opening')
			})
			const heard = listenTo({ project })
			// posted already: the later changes of the store post those changes only, in order
			await store.updateDocument(documentId, { name: 'renamed later' })
			await store.bulkWrite(documentId, { creates: [makeRecord({ id: 'r-later' })] })
			await vi.waitFor(function lastHeard() {
				expect(heard.at(-1)).toBe(`commit ${documentId}`)
			})
			expect(heard).toEqual([`document-updated ${documentId}`, `commit ${documentId}`])
		})
	}
})

/** `during` run once the project's own read of its documents answered, before the open goes on (the store's open read is its own). */
function duringOpenRead(params: { store: Store; during: () => Promise<void> }): void {
	const { store, during } = params
	const opened = store.open.bind(store)
	store.open = async function openThenWrapRead() {
		await opened()
		const read = store.getDocuments.bind(store)
		store.getDocuments = async function readThenDuring() {
			store.getDocuments = read
			const documents = await read()
			await during()
			return documents
		}
	}
}

describe('a call made while the project opens', () => {
	it('made as the open reads its documents → refused PROJECT_NOT_OPENED, nothing done', async () => {
		const name = `called-${crypto.randomUUID()}`
		const store = new InMemoryStore(name, { runtime: RUNTIME })
		made.push(store)
		const project = new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		})
		let answer: unknown
		duringOpenRead({
			store,
			during: async function calledDuringOpen() {
				answer = await project.initEmptyDocument().then(
					function accepted() {
						return 'accepted'
					},
					function refused(thrown: unknown) {
						return toDialecteError(thrown)?.key
					},
				)
			},
		})
		await project.open(name)
		onTestFinished(function closeProject() {
			return project.close()
		})
		expect(answer).toBe('PROJECT_NOT_OPENED')
		expect(project.state.documents.size).toBe(0)
	})
})

type ReadFailureCase = { thrown: () => unknown; reported: boolean }
const readFailureCases: Record<string, ReadFailureCase> = {
	'its engine lost (the resync that follows repairs it) → not reported': {
		thrown: function engineLost() {
			return createDialecteError('STORE_CONNECTION_LOST', { detail: 'the host went away' })
		},
		reported: false,
	},
	'any other failure → reported': {
		thrown: function readRefused() {
			return new Error('the read refused')
		},
		reported: true,
	},
}

describe('a fold whose read of the store fails', () => {
	for (const [description, { thrown, reported }] of Object.entries(readFailureCases)) {
		it(description, async () => {
			const { project, store, documentId } = await openHeld()
			const failure = thrown()
			const read = store.getDocument.bind(store)
			store.getDocument = async function refusedOnce() {
				store.getDocument = read
				throw failure
			}
			const logged = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
			onTestFinished(function restoreConsole() {
				logged.mockRestore()
			})
			await store.updateDocument(documentId, { name: 'renamed' })
			// a later fold read again, once the failed one ran
			await store.updateDocument(documentId, { name: 'renamed again' })
			await vi.waitFor(function foldedAgain() {
				expect(project.state.documents.get(documentId)?.record.name).toBe('renamed again')
			})
			expect(logged.mock.calls.length).toBe(reported ? 1 : 0)
		})
	}
})

type ReadAgainCase = {
	tell: (params: { tell: (notice: StoreNotice) => void }) => void
	/** Whether the project reads its documents again once open (else the changes are folded one by one). */
	readAgain: boolean
}
/** `count` commits of another connection, of a document the project does not hold. */
function commitsTold(params: { tell: (notice: StoreNotice) => void; count: number }): void {
	for (let index = 0; index < params.count; index += 1) {
		params.tell({
			type: 'change',
			message: { type: 'commit', documentId: 'unknown', timestamp: index },
			own: false,
		})
	}
}
const readAgainCases: Record<string, ReadAgainCase> = {
	'a resync': {
		tell: function resyncTold({ tell }) {
			tell({ type: 'resync' })
		},
		readAgain: true,
	},
	[`${CHANGES_HELD_MAX} changes`]: {
		tell: function heldTold({ tell }) {
			commitsTold({ tell, count: CHANGES_HELD_MAX })
		},
		readAgain: false,
	},
	[`more than ${CHANGES_HELD_MAX} changes`]: {
		tell: function manyTold({ tell }) {
			commitsTold({ tell, count: CHANGES_HELD_MAX + 1 })
		},
		readAgain: true,
	},
}

describe('told while the project opens', () => {
	for (const [description, { tell: toldDuringOpen, readAgain }] of Object.entries(readAgainCases)) {
		it(`${description} → ${readAgain ? 'its documents read again once open: one written meanwhile, told to no one, in its state; a listener joined meanwhile told to read again' : 'folded one by one once open, its documents not read again; a listener joined meanwhile told each'}`, async () => {
			const name = `read-again-${crypto.randomUUID()}`
			const { store, tell } = toldStore({ name })
			made.push(store)
			const project = new Project({
				configs: { default: CONFIG },
				storage: { type: 'custom', store },
			})
			let heard: string[] = []
			let unseen = ''
			let readsAfterOpen = 0
			duringOpenRead({
				store,
				during: async function writtenUntold() {
					// a listener of the project's channel joined while it opens
					heard = listenTo({ project })
					const elsewhere = new InMemoryStore(name, { runtime: RUNTIME })
					await elsewhere.open()
					const { record } = await elsewhere.importFile({
						file: new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'unseen.xml'),
					})
					await elsewhere.close()
					unseen = record.id
					toldDuringOpen({ tell })
					// the open's own read answered: every later one is a reading again
					const read = store.getDocuments.bind(store)
					store.getDocuments = function countedRead() {
						readsAfterOpen += 1
						return read()
					}
				},
			})
			await project.open(name)
			onTestFinished(function closeProject() {
				return project.close()
			})
			// a reading again starts as the open settles: counted by now
			expect(readsAfterOpen).toBe(readAgain ? 1 : 0)
			if (!readAgain) {
				await vi.waitFor(function eachTold() {
					expect(heard).toEqual(Array(CHANGES_HELD_MAX).fill('commit unknown'))
				})
				return
			}
			await vi.waitFor(function readAgainHolds() {
				expect(project.state.documents.has(unseen)).toBe(true)
				expect(heard).toEqual(['resync -'])
			})
		})
	}
})

describe('an open a close was called after', () => {
	it('changes told while it opened → neither folded nor posted: the project closes', async () => {
		const name = `overtaken-${crypto.randomUUID()}`
		const { store, tell } = toldStore({ name })
		made.push(store)
		const project = new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		})
		const posted = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
		onTestFinished(function restorePost() {
			posted.mockRestore()
		})
		let closing: Promise<void> = Promise.resolve()
		duringOpenRead({
			store,
			during: async function closedWhileOpening() {
				tell({
					type: 'change',
					message: { type: 'commit', documentId: 'unknown', timestamp: 1 },
					own: false,
				})
				closing = project.close()
			},
		})
		await project.open(name)
		await closing
		expect(posted).not.toHaveBeenCalled()
	})
})

describe('a Document subscriber throwing as a call of the project changes its document', () => {
	type CallCase = {
		/** The store wrapped before the call, when the call meets a lost engine. */
		engineLost: boolean
		/** What the call rejects with: the subscriber's failure, or the lost engine. */
		rejected: 'subscriber' | 'STORE_CONNECTION_LOST'
	}
	const callCases: Record<string, CallCase> = {
		'an undo its store refuses STORE_CONNECTION_LOST → rejected STORE_CONNECTION_LOST, the subscriber’s failure reported':
			{
				engineLost: true,
				rejected: 'STORE_CONNECTION_LOST',
			},
	}
	for (const [description, { engineLost, rejected }] of Object.entries(callCases)) {
		it(description, async () => {
			const { project, store, documentId } = await openHeld()
			await project.openDocument(documentId).transaction(async function addOne(tx) {
				const root = await tx.getRoot()
				await tx.addChild(root, { tagName: 'A', attributes: [] })
			})
			const heard = listenTo({ project })
			const reports = quietReports()
			const failure = new Error('a subscriber failing')
			project.openDocument(documentId).subscribe(function failing(terminal) {
				if (terminal) throw failure
			})
			if (engineLost) {
				store.undo = async function lostWhileUndoing() {
					throw createDialecteError('STORE_CONNECTION_LOST', { detail: 'the host went away' })
				}
			}
			const outcome = await project.undo(documentId).then(
				function undone() {
					return 'undone'
				},
				function refused(thrown: unknown) {
					return thrown === failure ? 'subscriber' : toDialecteError(thrown)?.key
				},
			)
			expect(outcome).toBe(rejected)
			if (engineLost) {
				expect(reportedFailures({ reports })).toEqual([failure])
				return
			}
			await vi.waitFor(function commitPosted() {
				expect(heard).toContain(`commit ${documentId}`)
			})
		})
	}
})

describe('a resync, a subscriber of one document throwing', () => {
	it('→ every other document’s subscribers woken all the same, the failure reported', async () => {
		const name = `resync-throwing-${crypto.randomUUID()}`
		const { store, tell } = toldStore({ name })
		made.push(store)
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open(name)
		onTestFinished(function closeProject() {
			return project.close()
		})
		const first = await project.initEmptyDocument()
		const second = await project.initEmptyDocument()
		const reports = quietReports()
		const failure = new Error('a subscriber failing')
		let woken = 0
		for (const documentId of [first, second]) {
			project.openDocument(documentId).subscribe(function failingOrCounting(terminal) {
				if (!terminal) return
				if (documentId === first) throw failure
				woken += 1
			})
		}
		tell({ type: 'resync' })
		await vi.waitFor(function secondWoken() {
			expect(woken).toBe(1)
			expect(reportedFailures({ reports })).toContain(failure)
		})
	})
})

describe('a resync told to the channel’s listeners', () => {
	it('→ posted once the documents and their history are read again: a listener reading canUndo then sees the commit made meanwhile', async () => {
		const name = `resync-history-${crypto.randomUUID()}`
		const { store, tell } = toldStore({ name })
		made.push(store)
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open(name)
		onTestFinished(function closeProject() {
			return project.close()
		})
		const documentId = await project.initEmptyDocument()
		// a commit by another connection, told to no one
		const elsewhere = new InMemoryStore(name, { runtime: RUNTIME })
		await elsewhere.open()
		await commit({ store: elsewhere, documentId, creates: [makeRecord({ id: 'r-elsewhere' })] })
		await elsewhere.close()
		// the history read slow: a notice posted before it would show the history of before
		const readHistory = store.getHistoryStatus.bind(store)
		store.getHistoryStatus = async function slowHistory(id) {
			await new Promise(function slowly(resolve) {
				setTimeout(resolve, 100)
			})
			return readHistory(id)
		}
		const seen: boolean[] = []
		const channel = project.createChannel()
		onTestFinished(function closeChannel() {
			channel.close()
		})
		channel.onmessage = function readOnResync(event: MessageEvent<{ type: string }>) {
			if (event.data.type !== 'resync') return
			seen.push(project.state.documents.get(documentId)?.canUndo ?? false)
		}
		tell({ type: 'resync' })
		await vi.waitFor(function told() {
			expect(seen).toEqual([true])
		})
	})
})
