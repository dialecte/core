import { makeDocument } from '../../contract/store-contract.fixtures'
import {
	clientOf,
	fixtureUrl,
	openMessage,
	removePoolDirectory,
	startEngineWorker,
	uniqueProject,
} from './runtime.fixtures'
import { ENGINE_CHUNK_FAILURE, ENGINE_WORKER_CASE_TIMEOUT_MS } from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'

import type { RuntimeFixtureScenario } from './runtime.fixtures.types'
import type { DialecteError } from '@/errors'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** What a case leaves: its workers ended, its pools removed. */
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An engine worker of a scenario that shapes how its engine's chunk loads; ended, its project's pool removed, after the case. */
function engineWorkerOf(params: {
	scenario: RuntimeFixtureScenario
	project: string
}): ReturnType<typeof startEngineWorker> {
	const started = startEngineWorker({ url: fixtureUrl({ scenario: params.scenario }) })
	cleanups.push(started.end, () => removePoolDirectory({ project: params.project }))
	return started
}

/** The refusal a control request ends with, read as a dialecte error; none when it resolved or threw something else. */
async function refusalOf(params: { action: Promise<unknown> }): Promise<DialecteError | undefined> {
	try {
		await params.action
		return undefined
	} catch (thrown) {
		return toDialecteError(thrown)
	}
}

describe('an engine worker whose engine chunk is still loading when control messages reach it', () => {
	it('an open and an adoption posted at once, in its first turn → each answered, in the order sent: the adopted client reads the project the open made', async () => {
		const project = uniqueProject()
		const { control } = engineWorkerOf({ scenario: 'slow-engine-chunk', project })
		const opening = control.request({ message: openMessage({ project }), expect: 'opened' })
		const adopting = clientOf({ control, clientId: 'writer' })
		const opened = await opening
		expect(opened).toMatchObject({ type: 'opened' })
		const engine = await adopting
		await engine.registerDocument(makeDocument({ id: 'doc-1' }))
		const documents = await engine.getDocuments()
		expect(documents).toEqual([makeDocument({ id: 'doc-1' })])
		const closed = await control.request({ message: { type: 'close' }, expect: 'closed' })
		expect(closed).toMatchObject({ type: 'closed' })
	})
})

describe('an engine worker whose engine chunk fails to load', () => {
	it('every control message answered failed, as data: PROJECT_ENGINE_UNAVAILABLE naming the chunk and its failure, and the worker still answering', async () => {
		const project = uniqueProject()
		const { control } = engineWorkerOf({ scenario: 'failing-engine-chunk', project })
		const refusals = [
			await refusalOf({
				action: control.request({ message: openMessage({ project }), expect: 'opened' }),
			}),
			await refusalOf({ action: clientOf({ control, clientId: 'writer' }) }),
			await refusalOf({
				action: control.request({ message: { type: 'close' }, expect: 'closed' }),
			}),
		]
		for (const refusal of refusals) {
			expect(refusal).toMatchObject({
				key: 'PROJECT_ENGINE_UNAVAILABLE',
				detail: expect.stringContaining(ENGINE_CHUNK_FAILURE),
			})
			expect(refusal?.detail).toContain('chunk')
		}
	})
})
