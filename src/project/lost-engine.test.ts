import { Project } from './project'

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createDialecteError, toDialecteError } from '@/errors'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { Transaction } from '@/document'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

/** Whether a write lands before its engine is lost, or is lost with it. */
type Landing = 'applied' | 'not-applied'

/** The stores a case made: destroyed after it. */
const made: Store[] = []

afterEach(async () => {
	for (const store of made.splice(0)) await store.destroy()
})

function lost(params: { writeId?: string }): Error {
	return createDialecteError('STORE_CONNECTION_LOST', {
		detail: 'its host went while the call waited',
		meta: { reason: 'host-gone', ...(params.writeId !== undefined && { writeId: params.writeId }) },
	})
}

/** A write member a case may lose its engine during. */
type LosingMember = 'commit' | 'importFile' | 'undo' | 'redo' | 'removeDocument'

/**
 * An in-memory store whose writes named in `losing` are refused `STORE_CONNECTION_LOST` - landed first or not, as
 * `landing` says - each counted; the first `losses` of them only (all when not given); `outcomeRefused`: the ask of
 * a lost write's outcome refused too; `announcing: false`: a store that tells no change (no `subscribe`). Every other
 * member as the store answers it.
 */
function losingStore(params: {
	name: string
	losing: LosingMember[]
	landing: Landing
	losses?: number
	outcomeRefused?: boolean
	announcing?: boolean
}): { store: Store; calls: Record<LosingMember, number> } {
	const { losing, landing, outcomeRefused = false, announcing = true } = params
	let losses = params.losses ?? Number.POSITIVE_INFINITY
	const store = new InMemoryStore(params.name, { runtime: RUNTIME })
	made.push(store)
	const calls: Record<LosingMember, number> = {
		commit: 0,
		importFile: 0,
		undo: 0,
		redo: 0,
		removeDocument: 0,
	}
	function losingWrite<GenericArgs extends unknown[], GenericValue>(write: {
		member: LosingMember
		call: (...args: GenericArgs) => Promise<GenericValue>
		writeIdOf: (...args: NoInfer<GenericArgs>) => string | undefined
	}): (...args: GenericArgs) => Promise<GenericValue> {
		return async function lostOrAnswered(...args) {
			calls[write.member] += 1
			if (!losing.includes(write.member) || losses <= 0) return write.call(...args)
			losses -= 1
			if (landing === 'applied') await write.call(...args)
			throw lost({ writeId: write.writeIdOf(...args) })
		}
	}
	function noWriteId(): undefined {
		return undefined
	}
	store.commit = losingWrite({
		member: 'commit',
		call: store.commit.bind(store),
		writeIdOf: function commitWriteId(commitParams) {
			return commitParams.writeId
		},
	})
	store.importFile = losingWrite({
		member: 'importFile',
		call: store.importFile.bind(store),
		writeIdOf: function importWriteId(importParams) {
			return importParams.writeId
		},
	})
	store.undo = losingWrite({ member: 'undo', call: store.undo.bind(store), writeIdOf: noWriteId })
	store.redo = losingWrite({ member: 'redo', call: store.redo.bind(store), writeIdOf: noWriteId })
	store.removeDocument = losingWrite({
		member: 'removeDocument',
		call: store.removeDocument.bind(store),
		writeIdOf: noWriteId,
	})
	if (!announcing) {
		// read as any store: one that tells no change has no `subscribe`
		const tellingNothing: Store = store
		tellingNothing.subscribe = undefined
	}
	if (outcomeRefused) {
		store.getWriteOutcome = async function outcomeLostToo() {
			throw lost({})
		}
	}
	return { store, calls }
}

/** What a listener of the project's channel heard, as `{ type, documentId }`; its channel closed after the case. */
function heardOn(params: { project: Project<AnyDialecteConfig> }): {
	type: string
	documentId?: string
}[] {
	const heard: { type: string; documentId?: string }[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function hear(event: MessageEvent) {
		const message = event.data as { type: string; documentId?: string }
		heard.push({ type: message.type, documentId: message.documentId })
	}
	onTestFinished(function closeChannel() {
		channel.close()
	})
	return heard
}

function sourceFile(): File {
	return new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/></Root>`], 'source.xml')
}

async function openOn(params: { store: Store; name: string }): Promise<Project<AnyDialecteConfig>> {
	return new Project({
		configs: { default: CONFIG },
		storage: { type: 'custom', store: params.store },
	}).open(params.name)
}

async function settledOf(params: { action: Promise<unknown> }): Promise<{
	key?: string
	outcome?: unknown
	documentId?: unknown
}> {
	return params.action.then(
		function resolved() {
			return {}
		},
		function refused(thrown: unknown) {
			const error = toDialecteError(thrown)
			return {
				key: error?.key,
				outcome: error?.meta?.outcome,
				documentId: error?.meta?.documentId,
			}
		},
	)
}

/**
 * A blob added to the document after the case's write: posted on the project's channel after anything the write
 * posted (one sender's messages arrive in order), so a listener that heard it heard all the write posted.
 */
async function fenceOf(params: {
	project: Project<AnyDialecteConfig>
	documentId: string
}): Promise<{ type: string; documentId: string }> {
	await params.project.addBlob(params.documentId, new File(['fence'], 'fence.txt'))
	return { type: 'blob-added', documentId: params.documentId }
}

/** One `A` added under the document's root. */
async function addOneA(tx: Transaction<AnyDialecteConfig>): Promise<void> {
	const root = await tx.getRoot()
	await tx.addChild(root, { tagName: 'A', attributes: [] })
}

/** A project open on the losing store, one document imported into it. */
async function openWithDocument(params: {
	losing: LosingMember[]
	landing: Landing
	losses?: number
	outcomeRefused?: boolean
	announcing?: boolean
}): Promise<{
	project: Project<AnyDialecteConfig>
	store: Store
	calls: Record<LosingMember, number>
	documentId: string
}> {
	const name = `lost-${crypto.randomUUID()}`
	const { store, calls } = losingStore({ name, ...params })
	const project = await openOn({ store, name })
	onTestFinished(function closeProject() {
		return project.close()
	})
	const { documentId } = await project.importFile(sourceFile())
	return { project, store, calls, documentId }
}

describe('a project whose engine is lost during its write', () => {
	type CommitCase = {
		landing: Landing
		outcomeRefused?: boolean
		announcing?: boolean
		expected: { key?: string; outcome?: string }
		canUndo: boolean
		heard: { type: string; documentId: true }[]
	}
	const commitCases: Record<string, CommitCase> = {
		'a commit that landed → the transaction resolves, the change there, posted to the listeners': {
			landing: 'applied',
			expected: {},
			canUndo: true,
			heard: [{ type: 'commit', documentId: true }],
		},
		'a commit that did not land → STORE_CONNECTION_LOST, meta.outcome not-applied, nothing posted':
			{
				landing: 'not-applied',
				expected: { key: 'STORE_CONNECTION_LOST', outcome: 'not-applied' },
				canUndo: false,
				heard: [],
			},
		'a commit that landed, its outcome not known (the ask lost too) → STORE_CONNECTION_LOST, meta.outcome unknown; its history read again, the change the store told posted':
			{
				landing: 'applied',
				outcomeRefused: true,
				expected: { key: 'STORE_CONNECTION_LOST', outcome: 'unknown' },
				canUndo: true,
				heard: [{ type: 'commit', documentId: true }],
			},
		'on a store that tells no change, a commit that did not land → STORE_CONNECTION_LOST not-applied, nothing posted':
			{
				landing: 'not-applied',
				announcing: false,
				expected: { key: 'STORE_CONNECTION_LOST', outcome: 'not-applied' },
				canUndo: false,
				heard: [],
			},
		'on a store that tells no change, a commit whose outcome is not known → STORE_CONNECTION_LOST unknown, posted (it may have landed)':
			{
				landing: 'applied',
				outcomeRefused: true,
				announcing: false,
				expected: { key: 'STORE_CONNECTION_LOST', outcome: 'unknown' },
				canUndo: true,
				heard: [{ type: 'commit', documentId: true }],
			},
	}
	for (const [
		description,
		{ landing, outcomeRefused, announcing, expected, canUndo, heard },
	] of Object.entries(commitCases)) {
		it(description, async () => {
			const { project, calls, documentId } = await openWithDocument({
				losing: ['commit'],
				landing,
				outcomeRefused,
				announcing,
			})
			const listened = heardOn({ project })
			const settled = await settledOf({
				action: project.openDocument(documentId).transaction(addOneA),
			})
			expect(settled).toMatchObject(expected)
			expect(calls.commit).toBe(1)
			expect(project.state.documents.get(documentId)?.canUndo).toBe(canUndo)
			const expectedHeard = heard.map(function withId({ type }) {
				return { type, documentId }
			})
			// heard before any later write of the project's: a later one posts what the store told before it
			await vi.waitFor(function heardFirst() {
				expect(listened).toEqual(expectedHeard)
			})
			const fence = await fenceOf({ project, documentId })
			await vi.waitFor(function heardAll() {
				expect(listened).toEqual([...expectedHeard, fence])
			})
		})
	}

	it('a prepared commit that did not land → STORE_CONNECTION_LOST not-applied; committed again → it lands', async () => {
		const { project, store, calls, documentId } = await openWithDocument({
			losing: ['commit'],
			landing: 'not-applied',
			losses: 1,
		})
		const prepared = await project.openDocument(documentId).prepare(addOneA)
		const settled = await settledOf({ action: prepared.commit() })
		expect(settled).toMatchObject({ key: 'STORE_CONNECTION_LOST', outcome: 'not-applied' })
		await prepared.commit()
		expect(calls.commit).toBe(2)
		const historyStatus = await store.getHistoryStatus(documentId)
		expect(historyStatus).toMatchObject({ canUndo: true })
		expect(project.state.documents.get(documentId)?.canUndo).toBe(true)
	})

	it('a prepared commit whose outcome is not known → STORE_CONNECTION_LOST unknown; committed again → nothing made again', async () => {
		const { project, calls, documentId } = await openWithDocument({
			losing: ['commit'],
			landing: 'applied',
			losses: 1,
			outcomeRefused: true,
		})
		const prepared = await project.openDocument(documentId).prepare(addOneA)
		const settled = await settledOf({ action: prepared.commit() })
		expect(settled).toMatchObject({ key: 'STORE_CONNECTION_LOST', outcome: 'unknown' })
		await prepared.commit()
		expect(calls.commit).toBe(1)
	})

	type ImportCase = {
		landing: Landing
		announcing?: boolean
		outcomeRefused?: boolean
		outcome: string
		inState: boolean
		heard: string[]
	}
	const importCases: Record<string, ImportCase> = {
		'an import that landed → STORE_CONNECTION_LOST, meta.outcome applied and its documentId: the document in the project (its diagnostics went with the lost answer), posted to the listeners':
			{ landing: 'applied', outcome: 'applied', inState: true, heard: ['document-imported'] },
		'an import that did not land → STORE_CONNECTION_LOST, meta.outcome not-applied: no document, nothing posted':
			{ landing: 'not-applied', outcome: 'not-applied', inState: false, heard: [] },
		'an import that landed, its outcome not known (the ask lost too) → STORE_CONNECTION_LOST, meta.outcome unknown; the change the store told posted':
			{
				landing: 'applied',
				outcomeRefused: true,
				outcome: 'unknown',
				inState: true,
				heard: ['document-imported'],
			},
		'on a store that tells no change, an import that landed → STORE_CONNECTION_LOST applied, the document posted to the listeners':
			{
				landing: 'applied',
				announcing: false,
				outcome: 'applied',
				inState: true,
				heard: ['document-imported'],
			},
	}
	for (const [
		description,
		{ landing, announcing, outcomeRefused, outcome, inState, heard },
	] of Object.entries(importCases)) {
		it(description, async () => {
			const name = `lost-${crypto.randomUUID()}`
			const { store, calls } = losingStore({
				name,
				losing: ['importFile'],
				landing,
				announcing,
				outcomeRefused,
				losses: 1,
			})
			const project = await openOn({ store, name })
			onTestFinished(function closeProject() {
				return project.close()
			})
			const listened = heardOn({ project })
			const settled = await settledOf({ action: project.importFile(sourceFile()) })
			expect(settled.key).toBe('STORE_CONNECTION_LOST')
			expect(settled.outcome).toBe(outcome)
			expect(calls.importFile).toBe(1)
			const documents = await store.getDocuments()
			expect(documents.length > 0).toBe(inState)
			if (inState) {
				// the document it made is named only when the outcome is known
				expect(settled.documentId).toBe(outcome === 'applied' ? documents[0]!.id : undefined)
				await vi.waitFor(function inProject() {
					expect(project.state.documents.has(documents[0]!.id)).toBe(true)
				})
			}
			await vi.waitFor(function heardFirst() {
				expect(
					listened.map(function typeOf({ type }) {
						return type
					}),
				).toEqual(heard)
			})
			// a second import, its engine kept: posted after anything the lost one posted
			await project.importFile(sourceFile())
			await vi.waitFor(function heardAll() {
				expect(
					listened.map(function typeOf({ type }) {
						return type
					}),
				).toEqual([...heard, 'document-imported'])
			})
		})
	}

	it('an import of a batch that landed → its entry failed STORE_CONNECTION_LOST, meta.outcome applied and the documentId made', async () => {
		const name = `lost-${crypto.randomUUID()}`
		const { store, calls } = losingStore({ name, losing: ['importFile'], landing: 'applied' })
		const project = await openOn({ store, name })
		onTestFinished(function closeProject() {
			return project.close()
		})
		const [entry] = await project.import([sourceFile()])
		const [document] = await store.getDocuments()
		expect(entry).toMatchObject({
			status: 'failed',
			error: {
				key: 'STORE_CONNECTION_LOST',
				meta: { outcome: 'applied', documentId: document!.id },
			},
		})
		expect(calls.importFile).toBe(1)
	})

	type HistoryCase = {
		member: 'undo' | 'redo' | 'removeDocument'
		prepare?: (params: { project: Project<AnyDialecteConfig>; documentId: string }) => Promise<void>
		write: (params: { project: Project<AnyDialecteConfig>; documentId: string }) => Promise<void>
		heard: string
		expected: (params: { project: Project<AnyDialecteConfig>; documentId: string }) => void
	}
	const historyCases: Record<string, HistoryCase> = {
		'an undo that landed → STORE_CONNECTION_LOST, never made again; its history read again, posted to the listeners':
			{
				member: 'undo',
				write: function undo({ project, documentId }) {
					return project.undo(documentId)
				},
				heard: 'commit',
				expected: function undone({ project, documentId }) {
					expect(project.state.documents.get(documentId)).toMatchObject({
						canUndo: false,
						canRedo: true,
					})
				},
			},
		'a redo that landed → STORE_CONNECTION_LOST, never made again; its history read again, posted to the listeners':
			{
				member: 'redo',
				prepare: function undoFirst({ project, documentId }) {
					return project.undo(documentId)
				},
				write: function redo({ project, documentId }) {
					return project.redo(documentId)
				},
				heard: 'commit',
				expected: function redone({ project, documentId }) {
					expect(project.state.documents.get(documentId)).toMatchObject({
						canUndo: true,
						canRedo: false,
					})
				},
			},
		'a removal that landed → STORE_CONNECTION_LOST, never made again; the document gone from the project, posted to the listeners':
			{
				member: 'removeDocument',
				write: function remove({ project, documentId }) {
					return project.removeDocument(documentId)
				},
				heard: 'document-removed',
				expected: function removed({ project, documentId }) {
					expect(project.state.documents.has(documentId)).toBe(false)
				},
			},
	}
	for (const [description, { member, prepare, write, heard, expected }] of Object.entries(
		historyCases,
	)) {
		it(description, async () => {
			const { project, calls, documentId } = await openWithDocument({
				losing: [member],
				landing: 'applied',
			})
			await project.openDocument(documentId).transaction(addOneA)
			await prepare?.({ project, documentId })
			const listened = heardOn({ project })
			const settled = await settledOf({ action: write({ project, documentId }) })
			expect(settled.key).toBe('STORE_CONNECTION_LOST')
			expect(calls[member]).toBe(1)
			expected({ project, documentId })
			await vi.waitFor(function heardFirst() {
				expect(listened).toEqual([{ type: heard, documentId }])
			})
			// a second document imported: posted after anything the lost write posted (the first may be removed)
			const { documentId: fenceId } = await project.importFile(sourceFile())
			await vi.waitFor(function heardIt() {
				expect(listened).toEqual([
					{ type: heard, documentId },
					{ type: 'document-imported', documentId: fenceId },
				])
			})
		})
	}
})
