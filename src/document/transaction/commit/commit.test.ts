import { commitTransaction } from './commit'

import { describe, expect, it, vi } from 'vitest'

import { createProgressReporter } from '@/document/progress'
import { createDialecteError, toDialecteError } from '@/errors'
import { createTestRecord } from '@/test'

import type { DocumentState } from '@/document'
import type { Store, WriteOutcome } from '@/store'
import type { TestDialecteConfig } from '@/test'
import type { AnyRawRecord, Operation } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(): DocumentState {
	return {
		loading: false,
		error: null,
		progress: null,
		history: [],
		lastUpdate: null,
	}
}

type StoreCall = {
	creates: AnyRawRecord[]
	updates: AnyRawRecord[]
	deletes: string[]
	progressCalls: Array<{ current: number; total: number }>
}

function makeStore(options?: { shouldThrow?: Error }): { store: Store; calls: StoreCall } {
	const calls: StoreCall = { creates: [], updates: [], deletes: [], progressCalls: [] }

	const store: Store = {
		name: 'test-store',
		get: vi.fn(),
		getByDocumentId: vi.fn(),
		count: vi.fn(),
		getByTagNameInDocument: vi.fn(),
		getMany: vi.fn(),
		open: vi.fn(),
		close: vi.fn(),
		reconcile: vi.fn(),
		isDocumentReadable: vi.fn(),
		registerDocument: vi.fn(),
		getDocument: vi.fn(),
		getDocuments: vi.fn(),
		updateDocument: vi.fn(),
		removeDocument: vi.fn(),
		bulkWrite: vi.fn(),
		addBlob: vi.fn(),
		getBlob: vi.fn(),
		getBlobsByDocument: vi.fn(),
		getBlobsByRecord: vi.fn(),
		getStandaloneBlobs: vi.fn(),
		attachBlob: vi.fn(),
		detachBlob: vi.fn(),
		removeBlob: vi.fn(),
		commit: vi.fn(async ({ creates, updates, deletes, onProgress }) => {
			if (options?.shouldThrow) throw options.shouldThrow
			calls.creates = creates
			calls.updates = updates
			calls.deletes = deletes
			const total = creates.length + updates.length + deletes.length
			for (let i = 0; i < total; i++) {
				onProgress(i + 1, total)
				calls.progressCalls.push({ current: i + 1, total })
			}
		}),
		undo: vi.fn(),
		redo: vi.fn(),
		getHistoryStatus: vi.fn().mockResolvedValue({ canUndo: false, canRedo: false }),
		getChangeLog: vi.fn().mockResolvedValue([]),
		getDatabaseInstance: vi.fn(),
		destroy: vi.fn(),
		importFile: vi.fn(),
		getWriteOutcome: vi.fn(),
		exportFile: vi.fn(),
	}

	return { store, calls }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('commitTransaction', () => {
	it('sets loading and opens the commit plan before writing to store', async () => {
		const state = makeState()
		let loadingAtCommit: boolean | undefined
		let progressAtCommit: DocumentState['progress'] | undefined

		const store: Store = {
			name: 'test-store',
			get: vi.fn(),
			getByDocumentId: vi.fn(),
			count: vi.fn(),
			getByTagNameInDocument: vi.fn(),
			getMany: vi.fn(),
			open: vi.fn(),
			close: vi.fn(),
			destroy: vi.fn(),
			importFile: vi.fn(),
			getWriteOutcome: vi.fn(),
			exportFile: vi.fn(),
			reconcile: vi.fn(),
			isDocumentReadable: vi.fn(),
			registerDocument: vi.fn(),
			getDocument: vi.fn(),
			getDocuments: vi.fn(),
			updateDocument: vi.fn(),
			removeDocument: vi.fn(),
			bulkWrite: vi.fn(),
			addBlob: vi.fn(),
			getBlob: vi.fn(),
			getBlobsByDocument: vi.fn(),
			getBlobsByRecord: vi.fn(),
			getStandaloneBlobs: vi.fn(),
			attachBlob: vi.fn(),
			detachBlob: vi.fn(),
			removeBlob: vi.fn(),
			undo: vi.fn(),
			redo: vi.fn(),
			getHistoryStatus: vi.fn().mockResolvedValue({ canUndo: false, canRedo: false }),
			getChangeLog: vi.fn().mockResolvedValue([]),
			getDatabaseInstance: vi.fn(),
			commit: vi.fn(async () => {
				loadingAtCommit = state.loading
				progressAtCommit = structuredClone(state.progress)
			}),
		}

		const op: Operation<TestDialecteConfig> = {
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'r1' } }),
		}
		await commitTransaction({
			stagedOperations: [op],
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(loadingAtCommit).toBe(true)
		expect(progressAtCommit).toEqual({
			current: 0,
			total: 1,
			label: '',
			step: null,
		})
	})

	it('sets lastUpdate after a successful commit', async () => {
		const state = makeState()
		const { store } = makeStore()
		const before = Date.now()

		await commitTransaction({
			stagedOperations: [],
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(state.lastUpdate).toBeGreaterThanOrEqual(before)
		expect(state.lastUpdate).toBeLessThanOrEqual(Date.now())
	})

	it('endPlan() clears the commit plan after a successful commit (no main owner)', async () => {
		const state = makeState()
		const { store } = makeStore()

		await commitTransaction({
			stagedOperations: [],
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(state.progress).toBeNull()
	})

	it('forwards creates, updates and deletes to the store', async () => {
		const state = makeState()
		const { store, calls } = makeStore()

		const created: Operation<TestDialecteConfig> = {
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'c1' } }),
		}
		const updated: Operation<TestDialecteConfig> = {
			status: 'updated',
			oldRecord: createTestRecord({ record: { tagName: 'A', id: 'u1' } }),
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'u1' } }),
		}
		const deleted: Operation<TestDialecteConfig> = {
			status: 'deleted',
			oldRecord: createTestRecord({ record: { tagName: 'A', id: 'd1' } }),
			newRecord: undefined,
		}

		await commitTransaction({
			stagedOperations: [created, updated, deleted],
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(calls.creates).toEqual([createTestRecord({ record: { tagName: 'A', id: 'c1' } })])
		expect(calls.updates).toEqual([createTestRecord({ record: { tagName: 'A', id: 'u1' } })])
		expect(calls.deletes).toEqual(['d1'])
	})

	it('merges create+delete on the same id into a no-op', async () => {
		const state = makeState()
		const { store, calls } = makeStore()

		const created: Operation<TestDialecteConfig> = {
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'x1' } }),
		}
		const deleted: Operation<TestDialecteConfig> = {
			status: 'deleted',
			oldRecord: createTestRecord({ record: { tagName: 'A', id: 'x1' } }),
			newRecord: undefined,
		}

		await commitTransaction({
			stagedOperations: [created, deleted],
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(calls.creates).toHaveLength(0)
		expect(calls.updates).toHaveLength(0)
		expect(calls.deletes).toHaveLength(0)
	})

	it('updates progress via onProgress callbacks', async () => {
		const state = makeState()
		const { store, calls } = makeStore()

		const ops: Operation<TestDialecteConfig>[] = [
			{
				status: 'created',
				oldRecord: undefined,
				newRecord: createTestRecord({ record: { tagName: 'A', id: 'c1' } }),
			},
			{
				status: 'created',
				oldRecord: undefined,
				newRecord: createTestRecord({ record: { tagName: 'A', id: 'c2' } }),
			},
		]

		await commitTransaction({
			stagedOperations: ops,
			store,
			documentId: 'f1',
			documentState: state,
			progress: createProgressReporter(state),
		})

		expect(calls.progressCalls).toEqual([
			{ current: 1, total: 2 },
			{ current: 2, total: 2 },
		])
	})

	it('resets loading and ends the commit plan (clearing progress, no main owner) then rethrows on store error', async () => {
		const state = makeState()
		const err = new Error('DB exploded')
		const { store } = makeStore({ shouldThrow: err })

		const op: Operation<TestDialecteConfig> = {
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'r1' } }),
		}

		await expect(
			commitTransaction({
				stagedOperations: [op],
				store,
				documentId: 'f1',
				documentState: state,
				progress: createProgressReporter(state),
			}),
		).rejects.toThrow('DB exploded')

		expect(state.loading).toBe(false)
		expect(state.progress).toBeNull()
	})

	it('does not set lastUpdate on store error', async () => {
		const state = makeState()
		const { store } = makeStore({ shouldThrow: new Error('fail') })

		const op: Operation<TestDialecteConfig> = {
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id: 'r1' } }),
		}

		await expect(
			commitTransaction({
				stagedOperations: [op],
				store,
				documentId: 'f1',
				documentState: state,
				progress: createProgressReporter(state),
			}),
		).rejects.toThrow()

		expect(state.lastUpdate).toBeNull()
	})

	describe('a commit whose connection is lost (STORE_CONNECTION_LOST) → its outcome asked once by its writeId, never committed again', () => {
		type TestCase = {
			outcome: WriteOutcome | 'ask-fails'
			expected: { committed: true } | { refusedWith: string; outcome: string }
		}
		const testCases: Record<string, TestCase> = {
			'applied → the commit stands: resolved, lastUpdate set': {
				outcome: 'applied',
				expected: { committed: true },
			},
			'not applied → STORE_CONNECTION_LOST, meta.outcome not-applied: commit it again if wanted': {
				outcome: 'not-applied',
				expected: { refusedWith: 'STORE_CONNECTION_LOST', outcome: 'not-applied' },
			},
			'still running (a silent engine) → STORE_CONNECTION_LOST, meta.outcome running': {
				outcome: 'running',
				expected: { refusedWith: 'STORE_CONNECTION_LOST', outcome: 'running' },
			},
			'the outcome itself not answered → STORE_CONNECTION_LOST, meta.outcome unknown': {
				outcome: 'ask-fails',
				expected: { refusedWith: 'STORE_CONNECTION_LOST', outcome: 'unknown' },
			},
		}
		for (const [description, { outcome, expected }] of Object.entries(testCases)) {
			it(description, async () => {
				const lost = createDialecteError('STORE_CONNECTION_LOST', {
					detail: 'its host went',
					meta: { reason: 'host-gone' },
				})
				const { store } = makeStore({ shouldThrow: lost })
				const asked: string[] = []
				store.getWriteOutcome = vi.fn(async ({ writeId }: { writeId: string }) => {
					asked.push(writeId)
					if (outcome === 'ask-fails') throw lost
					return outcome
				})
				const state = makeState()
				const op: Operation<TestDialecteConfig> = {
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { tagName: 'A', id: 'r1' } }),
				}
				const settled = await commitTransaction({
					stagedOperations: [op],
					store,
					documentId: 'doc-1',
					documentState: state,
					progress: createProgressReporter(state),
				}).then(
					function committed() {
						return { committed: true } as const
					},
					function refused(thrown: unknown) {
						const error = toDialecteError(thrown)
						return { refusedWith: error?.key, outcome: error?.meta?.outcome }
					},
				)
				expect(settled).toEqual(expected)
				expect(store.commit).toHaveBeenCalledTimes(1)
				const [{ writeId }] = (store.commit as ReturnType<typeof vi.fn>).mock.calls[0]!
				expect(asked).toEqual([writeId])
				expect(state.lastUpdate !== null).toBe('committed' in expected)
				// refused, the commit gives the loading flag back; committed, its Document does
				if (!('committed' in expected)) expect(state.loading).toBe(false)
			})
		}

		it('another error → thrown as it is, no outcome asked', async () => {
			const { store } = makeStore({ shouldThrow: new Error('store failure') })
			const state = makeState()
			await expect(
				commitTransaction({
					stagedOperations: [],
					store,
					documentId: 'doc-1',
					documentState: state,
					progress: createProgressReporter(state),
				}),
			).rejects.toThrow('store failure')
			expect(store.getWriteOutcome).not.toHaveBeenCalled()
		})
	})
})
