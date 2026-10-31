import { ENGINE_LOCK_PREFIX } from '../../engine/engine.constants'
import { takeEngineLock } from './install-pool'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'

/** The project's engine lock held by this page until the answered release is called. */
async function holdLock(params: { project: string }): Promise<() => void> {
	let release: () => void = releaseNothing
	await new Promise<void>(function requestLock(held) {
		void navigator.locks.request(`${ENGINE_LOCK_PREFIX}${params.project}`, function hold() {
			held()
			return new Promise<void>(function waitForRelease(done) {
				release = done
			})
		})
	})
	return release
}

function releaseNothing(): void {}

function uniqueProject(): string {
	return `install-pool-${crypto.randomUUID()}`
}

describe('the engine lock waited for until a deadline', () => {
	it('free, its deadline passed already → taken', async () => {
		const held = await takeEngineLock({
			project: uniqueProject(),
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

	it('held, then let go before the deadline → taken', async () => {
		const project = uniqueProject()
		const release = await holdLock({ project })
		const taking = takeEngineLock({ project, mode: 'wait', deadline: performance.now() + 5_000 })
		setTimeout(release, 100)
		const held = await taking
		held.release()
	})
})
