import { createEngineClient } from '../../engine/client/engine-client'
import { createEngineControl } from '../../engine/client/engine-control'
import { ENGINE_LOCK_PREFIX } from '../../engine/engine.constants'
import { SQLITE_WASM_URL } from '../sqlite-wasm-url'
import { poolDirectoryOf } from './install-pool'
import { OPAQUE_DIRECTORY } from './runtime.constants'
import { RUNTIME_FIXTURE_CHANNEL } from './runtime.fixtures.constants'

import type { EngineControl } from '../../engine/client/client.types'
import type { EngineApi, EngineLockMode } from '../../engine/engine.types'
import type {
	RuntimeFixtureNotice,
	RuntimeFixtureOrder,
	RuntimeFixtureScenario,
} from './runtime.fixtures.types'
import type { SqliteEngineSettings } from './runtime.types'

/** The engine of core's test dialecte, as a dialecte's worker entry serves it. */
export const TEST_ENGINE_URL = new URL('../../../test/test-dialecte.worker.ts', import.meta.url)
	.href

/** Whether the project's engine lock is free now (taken and let go at once when it is). */
export function isEngineLockFree(params: { project: string }): Promise<boolean> {
	return navigator.locks.request(
		`${ENGINE_LOCK_PREFIX}${params.project}`,
		{ ifAvailable: true },
		function grantedOrNot(lock) {
			return lock !== null
		},
	)
}

/** The runtime's fixture worker on the platform a scenario shapes. */
export function fixtureUrl(params: { scenario: RuntimeFixtureScenario }): string {
	const url = new URL('./runtime.fixtures.worker.ts', import.meta.url)
	url.searchParams.set('scenario', params.scenario)
	return url.href
}

/** The fixture's engine workers given an order; resolves once one of them has taken it. */
export async function orderFixture(params: { order: RuntimeFixtureOrder }): Promise<void> {
	const { order } = params
	const listener = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	const acknowledged = new Promise<void>(function waitForAck(resolve) {
		listener.addEventListener('message', function hear(event: MessageEvent<RuntimeFixtureNotice>) {
			if (event.data.type === 'ack' && event.data.of === order.type) resolve()
		})
	})
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(order)
	channel.close()
	await acknowledged
	listener.close()
}

/** A project name of its own. */
export function uniqueProject(): string {
	return `runtime-${crypto.randomUUID()}`
}

/** An engine worker the case drives through its control messages; `end` terminates it. */
export function startEngineWorker(params: { url?: string } = {}): {
	worker: Worker
	control: EngineControl
	end: () => void
} {
	const worker = new Worker(params.url ?? TEST_ENGINE_URL, { type: 'module' })
	return {
		worker,
		control: createEngineControl({ worker }),
		end: function endWorker() {
			worker.terminate()
		},
	}
}

/** The open message of a project. */
export function openMessage(params: {
	project: string
	lock?: EngineLockMode
	budgetMs?: number
}): {
	type: 'open'
	project: string
	lock: EngineLockMode
	budgetMs: number
	perf: boolean
	settings: SqliteEngineSettings
} {
	const { project, lock = 'if-available', budgetMs = 10_000 } = params
	return {
		type: 'open',
		project,
		settings: { wasmUrl: SQLITE_WASM_URL },
		lock,
		budgetMs,
		perf: false,
	}
}

/** A client of the engine through a port of its own, adopted under `clientId`. */
export async function clientOf(params: {
	control: EngineControl
	clientId: string
}): Promise<EngineApi> {
	const { control, clientId } = params
	const channel = new MessageChannel()
	await control.request({
		message: { type: 'adopt-client', clientId, port: channel.port2 },
		expect: 'adopted',
		transfer: [channel.port2],
	})
	return createEngineClient({ port: channel.port1 }).api
}

/** What the private file system holds of the project's pool: its directory, and how many pool files. */
export async function poolState(params: {
	project: string
}): Promise<{ exists: boolean; files: number }> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY]) {
		try {
			directory = await directory.getDirectoryHandle(name)
		} catch {
			return { exists: name === OPAQUE_DIRECTORY, files: 0 }
		}
	}
	let files = 0
	for await (const handle of directory.values()) if (handle.kind === 'file') files += 1
	return { exists: true, files }
}

/** A worker holding one file of the project's pool, as an engine that ended may still do; `release` lets it go. */
export async function holdPoolFile(params: {
	project: string
}): Promise<{ file: string; release: () => Promise<void> }> {
	const worker = new Worker(fixtureUrl({ scenario: 'holder' }), { type: 'module' })
	const answer = function nextAnswer(): Promise<{ type: string; file?: string }> {
		return new Promise(function waitForAnswer(resolve) {
			worker.addEventListener('message', (event) => resolve(event.data), { once: true })
		})
	}
	const held = answer()
	worker.postMessage({ type: 'hold', project: params.project })
	const { file } = await held
	let gone = false
	return {
		file: file!,
		release: async function release() {
			if (gone) return
			gone = true
			const released = answer()
			worker.postMessage({ type: 'release' })
			await released
			worker.terminate()
		},
	}
}

/** A project's pool directory removed from the page, whatever it holds: a case cleans up after itself. */
export async function removePoolDirectory(params: { project: string }): Promise<void> {
	const root = await navigator.storage.getDirectory()
	try {
		const parent = await root.getDirectoryHandle(poolDirectoryOf(params).split('/')[0]!)
		await parent.removeEntry(encodeURIComponent(params.project), { recursive: true })
	} catch {
		// nothing there
	}
}
