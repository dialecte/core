import {
	holdEngineLock,
	isEngineLockFree,
	makeBlankPool,
	openMessage,
	poolFileDigests,
	poolState,
	removePoolDirectory,
	startEngineWorker,
	uniqueProject,
} from './runtime.fixtures'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { rejectionKey } from '@/errors/errors.fixtures'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** What a case leaves: its workers ended, its pools removed, the locks it held let go. */
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An engine worker the case drives; ended, and the project's pool removed, after the case. */
function engineWorker(params: { project: string }): ReturnType<typeof startEngineWorker> {
	const started = startEngineWorker()
	cleanups.push(started.end, () => removePoolDirectory({ project: params.project }))
	return started
}

describe('an open that must find its project (mustExist)', () => {
	it('a project made, closed, then its pool directory removed → refused PROJECT_NOT_FOUND, no pool made again, the lock let go', async () => {
		const project = uniqueProject()
		const first = engineWorker({ project })
		await first.control.request({ message: openMessage({ project }), expect: 'opened' })
		await first.control.request({ message: { type: 'close' }, expect: 'closed' })
		first.end()
		await removePoolDirectory({ project })
		const again = engineWorker({ project })
		const refusedKey = await rejectionKey({
			action: again.control.request({
				message: { ...openMessage({ project }), mustExist: true },
				expect: 'opened',
			}),
		})
		expect(refusedKey).toBe('PROJECT_NOT_FOUND')
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
		const lockFree = await isEngineLockFree({ project })
		expect(lockFree).toBe(true)
	})

	it('a pool of blank files only (no database) → refused PROJECT_NOT_FOUND, its files as they were', async () => {
		const project = uniqueProject()
		await makeBlankPool({ project, sizes: [0, 4096] })
		const blank = await poolFileDigests({ project })
		const engine = engineWorker({ project })
		const refusedKey = await rejectionKey({
			action: engine.control.request({
				message: { ...openMessage({ project }), mustExist: true },
				expect: 'opened',
			}),
		})
		expect(refusedKey).toBe('PROJECT_NOT_FOUND')
		const fileDigests = await poolFileDigests({ project })
		expect(fileDigests).toEqual(blank)
	})

	it('a project made and closed with no document → opened, the same creation id', async () => {
		const project = uniqueProject()
		const first = engineWorker({ project })
		const opened = await first.control.request({
			message: openMessage({ project }),
			expect: 'opened',
		})
		await first.control.request({ message: { type: 'close' }, expect: 'closed' })
		first.end()
		const again = engineWorker({ project })
		const reopened = await again.control.request({
			message: { ...openMessage({ project }), mustExist: true },
			expect: 'opened',
		})
		expect(reopened.creationId).toBe(opened.creationId)
	})

	it('another engine holds the project → refused PROJECT_ENGINE_BUSY, never PROJECT_NOT_FOUND', async () => {
		const project = uniqueProject()
		const release = await holdEngineLock({ project })
		cleanups.push(release)
		const engine = engineWorker({ project })
		const refusedKey = await rejectionKey({
			action: engine.control.request({
				message: { ...openMessage({ project, lock: 'wait', budgetMs: 200 }), mustExist: true },
				expect: 'opened',
			}),
		})
		expect(refusedKey).toBe('PROJECT_ENGINE_BUSY')
	})
})
