import { discardOnFailure, openSaveTarget, writeToTarget } from './save-to-disk'
import { deferred, REMOVE_FAILURE, stubDialog, stubRemovableDialog } from './save-to-disk.fixtures'

import { afterEach, describe, expect, vi } from 'vitest'

import { rejectionKey } from '@/errors/errors.fixtures'
import { runTestCases } from '@/test'

import type { SaveTarget } from './save-to-disk.types'
import type { BaseTestCase } from '@/test'

afterEach(() => {
	delete (window as any).showSaveFilePicker
	vi.restoreAllMocks()
})

describe('saveToDisk', () => {
	describe('discard: the file the dialog created removed while nothing was written to it', () => {
		type DiscardCase = BaseTestCase & {
			dialog: 'accepted' | 'cancelled' | 'lapsed' | 'none'
			remove?: Parameters<typeof stubRemovableDialog>[0]['remove']
			before?: 'written' | 'write failed' | 'discarded'
			fileSize?: number
			expectedRemoves: number
			expectedThrown?: 'the remove failure'
		}
		const testCases: Record<string, DiscardCase> = {
			'a chosen file not written -> removed': {
				dialog: 'accepted',
				expectedRemoves: 1,
			},
			'a browser whose handle has no remove -> nothing done': {
				dialog: 'accepted',
				remove: 'absent',
				expectedRemoves: 0,
			},
			'a download target (no dialog in the browser) -> nothing to remove': {
				dialog: 'none',
				expectedRemoves: 0,
			},
			'a download target (a lapsed gesture) -> nothing to remove': {
				dialog: 'lapsed',
				expectedRemoves: 0,
			},
			'a cancelled target -> nothing to remove': {
				dialog: 'cancelled',
				expectedRemoves: 0,
			},
			'after a successful write -> the saved file kept': {
				dialog: 'accepted',
				before: 'written',
				expectedRemoves: 0,
			},
			'after a write that failed -> the file left empty removed': {
				dialog: 'accepted',
				before: 'write failed',
				expectedRemoves: 1,
			},
			'a chosen file holding content (an existing file picked) -> kept': {
				dialog: 'accepted',
				fileSize: 5,
				expectedRemoves: 0,
			},
			'after a write that failed, the file holding its earlier content -> kept': {
				dialog: 'accepted',
				before: 'write failed',
				fileSize: 5,
				expectedRemoves: 0,
			},
			'a remove that failed -> the next discard removes the file': {
				dialog: 'accepted',
				remove: 'failing once',
				before: 'discarded',
				expectedRemoves: 2,
			},
			'a second discard -> removed once': {
				dialog: 'accepted',
				before: 'discarded',
				expectedRemoves: 1,
			},
			'the file already gone -> discarded, nothing thrown': {
				dialog: 'accepted',
				remove: 'not found',
				expectedRemoves: 1,
			},
			'a remove failing otherwise -> the failure thrown': {
				dialog: 'accepted',
				remove: 'failing',
				expectedRemoves: 1,
				expectedThrown: 'the remove failure',
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const removes = stubRemovableDialog({
				dialog: testCase.dialog,
				remove: testCase.remove ?? 'supported',
				failWrite: testCase.before === 'write failed',
				fileSize: testCase.fileSize,
			})
			const target = await openSaveTarget({ filename: 'a.txt' })
			if (testCase.before === 'written' && 'write' in target) await target.write(new Blob(['x']))
			if (testCase.before === 'write failed' && 'write' in target)
				await target.write(new Blob(['x'])).catch(() => {})
			if (testCase.before === 'discarded') await target.discard().catch(() => {})

			const discarded = expect(target.discard())

			if (testCase.expectedThrown) await discarded.rejects.toBe(REMOVE_FAILURE)
			else await discarded.resolves.toBeUndefined()
			expect(removes()).toBe(testCase.expectedRemoves)
		})
	})

	describe('a discard while the target is busy -> settles after it, as the target is left', () => {
		type BusyCase = BaseTestCase & {
			busy: 'a write that succeeds' | 'a write that fails' | 'another discard'
			expectedRemoves: number
		}
		const testCases: Record<string, BusyCase> = {
			'during a write that succeeds -> the saved file kept': {
				busy: 'a write that succeeds',
				expectedRemoves: 0,
			},
			'during a write that fails -> the file left empty removed': {
				busy: 'a write that fails',
				expectedRemoves: 1,
			},
			'during another discard -> settled with it, the file removed once': {
				busy: 'another discard',
				expectedRemoves: 1,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const gate = deferred()
			const removes = stubRemovableDialog({
				dialog: 'accepted',
				remove: 'supported',
				failWrite: testCase.busy === 'a write that fails',
				hold: {
					step: testCase.busy === 'another discard' ? 'remove' : 'write',
					until: gate.promise,
				},
			})
			const target = await openSaveTarget({ filename: 'a.txt' })
			const busy =
				testCase.busy === 'another discard' || !('write' in target)
					? target.discard()
					: target.write(new Blob(['x']))
			const busyDone = busy.catch(() => {})
			let settled = false
			const discarding = target.discard().then(function markSettled() {
				settled = true
			})
			await new Promise((resolve) => setTimeout(resolve, 0))
			const settledWhileBusy = settled

			gate.resolve()

			await expect(discarding).resolves.toBeUndefined()
			await busyDone
			expect(settledWhileBusy).toBe(false)
			expect(removes()).toBe(testCase.expectedRemoves)
		})
	})

	describe('discardOnFailure: work for a target opened for it', () => {
		type WorkCase = BaseTestCase & {
			work: 'succeeds' | 'fails'
			discard: 'succeeds' | 'fails'
			expected: 'the answer' | 'the work failure'
			expectedDiscarded: boolean
		}
		const testCases: Record<string, WorkCase> = {
			'the work succeeds -> its answer, the target kept': {
				work: 'succeeds',
				discard: 'succeeds',
				expected: 'the answer',
				expectedDiscarded: false,
			},
			'the work fails -> the target discarded, the failure thrown': {
				work: 'fails',
				discard: 'succeeds',
				expected: 'the work failure',
				expectedDiscarded: true,
			},
			"the work fails, the discard too -> the work's failure thrown": {
				work: 'fails',
				discard: 'fails',
				expected: 'the work failure',
				expectedDiscarded: true,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const workFailure = new Error('the work failed')
			let discarded = false
			const target: SaveTarget = {
				outcome: 'cancelled',
				discard: async function discard() {
					discarded = true
					if (testCase.discard === 'fails') throw new Error('the discard failed')
				},
			}

			const run = discardOnFailure({
				target,
				work: async function work() {
					if (testCase.work === 'fails') throw workFailure
					return 'answer'
				},
			})

			if (testCase.expected === 'the answer') await expect(run).resolves.toBe('answer')
			else await expect(run).rejects.toBe(workFailure)
			expect(discarded).toBe(testCase.expectedDiscarded)
		})
	})

	describe('a write after a discard -> refused, nothing written', () => {
		type RefusedCase = BaseTestCase & { dialog: 'accepted' | 'none' }
		const testCases: Record<string, RefusedCase> = {
			'the chosen file -> SAVE_TARGET_DISCARDED, no file made again': { dialog: 'accepted' },
			'a download -> SAVE_TARGET_DISCARDED, no download': { dialog: 'none' },
		}

		runTestCases.generic(testCases, async (testCase) => {
			const written = stubDialog({ dialog: testCase.dialog })
			const target = await openSaveTarget({ filename: 'a.txt' })
			await expect(target.discard()).resolves.toBeUndefined()

			const key = await rejectionKey({
				action: writeToTarget({ target, data: new Blob(['x']) }),
			})

			expect(key).toBe('SAVE_TARGET_DISCARDED')
			expect(written()).toBe('nowhere')
		})
	})
})
