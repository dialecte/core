import { engineLockNameOf } from '../served/engine-lock'
import { poolDirectoryOf, refuseShortSpace, takeEngineLock } from './install-pool'
import { isEngineLockFree } from './runtime.fixtures'
import { FIXTURE_DIALECTE } from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'

/** The project's engine lock held by this page until the answered release is called. */
async function holdLock(params: { project: string }): Promise<() => void> {
	let release: () => void = releaseNothing
	await new Promise<void>(function requestLock(held) {
		void navigator.locks.request(
			engineLockNameOf({ dialecteId: FIXTURE_DIALECTE.dialecteId, project: params.project }),
			function hold() {
				held()
				return new Promise<void>(function waitForRelease(done) {
					release = done
				})
			},
		)
	})
	return release
}

function releaseNothing(): void {}

function uniqueProject(): string {
	return `install-pool-${crypto.randomUUID()}`
}

describe('the directory of a project’s files', () => {
	type TestCase = { dialecteId: string; project: string; expected: string | 'PROJECT_NAME_INVALID' }
	const testCases: Record<string, TestCase> = {
		'a dialecte and a name → under the pool root, each part encoded': {
			dialecteId: 'core/test',
			project: 'north',
			expected: 'dialecte-projects/core%2Ftest/north',
		},
		'an empty name → refused': {
			dialecteId: 'core/test',
			project: '',
			expected: 'PROJECT_NAME_INVALID',
		},
		'a name `.` → refused': {
			dialecteId: 'core/test',
			project: '.',
			expected: 'PROJECT_NAME_INVALID',
		},
		'a name `..` → refused': {
			dialecteId: 'core/test',
			project: '..',
			expected: 'PROJECT_NAME_INVALID',
		},
		'an empty dialecte id → refused': {
			dialecteId: '',
			project: 'north',
			expected: 'PROJECT_NAME_INVALID',
		},
		'a dialecte id `..` → refused': {
			dialecteId: '..',
			project: 'north',
			expected: 'PROJECT_NAME_INVALID',
		},
	}
	for (const [description, { dialecteId, project, expected }] of Object.entries(testCases)) {
		it(description, () => {
			const answered = (() => {
				try {
					return poolDirectoryOf({ dialecteId, project })
				} catch (thrown) {
					return toDialecteError(thrown)?.key
				}
			})()
			expect(answered).toBe(expected)
		})
	}
})

describe('the engine lock waited for until a deadline', () => {
	it('free, its deadline passed already → taken', async () => {
		const held = await takeEngineLock({
			project: uniqueProject(),
			...FIXTURE_DIALECTE,
			mode: 'wait',
			deadline: performance.now() - 1,
		})
		held.release()
	})

	it('held, its deadline passed already → PROJECT_ENGINE_BUSY, though the holder lets go a moment later: what was spent before the lock is not given again', async () => {
		const project = uniqueProject()
		const release = await holdLock({ project })
		setTimeout(release, 300)
		const refused = await takeEngineLock({
			project,
			...FIXTURE_DIALECTE,
			mode: 'wait',
			deadline: performance.now() - 1,
		}).then(
			function unexpectedlyTaken(held) {
				held.release()
				return undefined
			},
			function refusedWith(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(refused).toBe('PROJECT_ENGINE_BUSY')
	})

	it('released → free for any other context as soon as the release has settled (what an engine answers after it, a page reads free)', async () => {
		const project = uniqueProject()
		const held = await takeEngineLock({
			project,
			...FIXTURE_DIALECTE,
			mode: 'if-available',
			deadline: performance.now(),
		})
		await held.release()
		await expect(isEngineLockFree({ project })).resolves.toBe(true)
	})

	it('held, then let go before the deadline → taken', async () => {
		const project = uniqueProject()
		const release = await holdLock({ project })
		const taking = takeEngineLock({
			project,
			...FIXTURE_DIALECTE,
			mode: 'wait',
			deadline: performance.now() + 5_000,
		})
		setTimeout(release, 100)
		const held = await taking
		held.release()
	})
})

describe('the space an origin has left, asked before a pool or an import writes', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('the browser refuses to estimate it → no shortage told: the write goes on, as when it tells no quota', async () => {
		vi.spyOn(navigator.storage, 'estimate').mockRejectedValueOnce(new Error('estimate refused'))
		await expect(refuseShortSpace({ project: uniqueProject(), bytes: 1 })).resolves.toBeUndefined()
	})

	it('fewer bytes left than asked → STORE_QUOTA_EXCEEDED', async () => {
		vi.spyOn(navigator.storage, 'estimate').mockResolvedValueOnce({ quota: 10, usage: 8 })
		const refused = await refuseShortSpace({ project: uniqueProject(), bytes: 5 }).then(
			function notRefused() {
				return undefined
			},
			function keyOf(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(refused).toBe('STORE_QUOTA_EXCEEDED')
	})
})
