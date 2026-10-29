import { ENGINE_SIGNAL } from '../engine.constants'
import { createEngineClient } from './engine-client'

import * as Comlink from 'comlink'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'

import type { EngineWire, WireRequest } from '../wire/wire.types'

/** What a case leaves: its clients closed, its fake engines' ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function outcomeOf(action: Promise<unknown>): Promise<unknown> {
	try {
		await action
		return 'resolved'
	} catch (thrown) {
		const error = toDialecteError(thrown)
		return { key: error?.key ?? String(thrown), meta: error?.meta }
	}
}

function busyWait(params: { ms: number }): void {
	const until = performance.now() + params.ms
	while (performance.now() < until);
}

/** A client watching its port for 300 ms of silence; its other end returned to play the engine. */
function watchedClient(): {
	client: ReturnType<typeof createEngineClient>
	engineSide: MessagePort
} {
	const channel = new MessageChannel()
	const client = createEngineClient({ port: channel.port1, heartbeatTimeoutMs: 300 })
	cleanups.push(
		() => client.close({ storeName: 'watched' }),
		() => channel.port2.close(),
	)
	return { client, engineSide: channel.port2 }
}

/** An engine that answers an abort at once and never answers anything else; every call recorded. */
function silentEngine(params: { port: MessagePort }): WireRequest[] {
	const calls: WireRequest[] = []
	const wire: EngineWire = {
		call: function recordCall(request) {
			calls.push(request)
			return request.member === 'abortExport' || request.member === 'abortImport'
				? Promise.resolve({ ok: true, value: undefined })
				: new Promise(function neverAnswered() {})
		},
	}
	Comlink.expose(wire, params.port)
	return calls
}

/** An engine that answers `getDocuments` at once and never answers anything else. */
function documentsOnlyEngine(params: { port: MessagePort }): void {
	const wire: EngineWire = {
		call: function answerDocumentsOnly(request) {
			return request.member === 'getDocuments'
				? Promise.resolve({ ok: true, value: [] })
				: new Promise(function neverAnswered() {})
		},
	}
	Comlink.expose(wire, params.port)
}

describe('a client watching its engine', () => {
	it('busy told, then an answer to another call, then silence past the timeout → no loss until a heartbeat; silent after it → lost', async () => {
		const { client, engineSide } = watchedClient()
		documentsOnlyEngine({ port: engineSide })
		const waiting = outcomeOf(client.api.getByDocumentId('doc-1'))
		engineSide.postMessage({ type: ENGINE_SIGNAL.busy })
		expect(await client.api.getDocuments()).toEqual([])
		const duringBusy = await Promise.race([
			waiting,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 700)),
		])
		expect(duringBusy).toBe('waiting')
		engineSide.postMessage({ type: ENGINE_SIGNAL.heartbeat })
		const afterBeat = await Promise.race([
			waiting,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 150)),
		])
		expect(afterBeat).toBe('waiting')
		expect(await waiting).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
	})

	it('the document resumed (a frozen tab coming back) while a call waits → the silence counts from the resume', async () => {
		const { client } = watchedClient()
		const calling = outcomeOf(client.api.getDocuments())
		await new Promise((resolve) => setTimeout(resolve, 250))
		document.dispatchEvent(new Event('resume'))
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 200)),
		])
		expect(early).toBe('waiting')
		expect(await calling).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
	})

	it('its page stalled past the timeout while a beat waited → no loss: the beat is read first; silent after → lost', async () => {
		const { client, engineSide } = watchedClient()
		const calling = outcomeOf(client.api.getDocuments())
		engineSide.postMessage({ type: 'heartbeat' })
		busyWait({ ms: 500 })
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 150)),
		])
		expect(early).toBe('waiting')
		expect(await calling).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
	})

	it('an export lost for no heartbeat → the engine told to abort it, by its id', async () => {
		const { client, engineSide } = watchedClient()
		const calls = silentEngine({ port: engineSide })
		expect(
			await outcomeOf(client.api.exportFile({ documentId: 'doc-1', exportId: 'export-1' })),
		).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
		await vi.waitFor(function abortAsked() {
			expect(calls.map((call) => [call.member, call.args])).toContainEqual([
				'abortExport',
				[{ exportId: 'export-1' }],
			])
		})
	})

	it('an import lost for no heartbeat → not aborted: a write may still apply, its outcome asked later', async () => {
		const { client, engineSide } = watchedClient()
		const calls = silentEngine({ port: engineSide })
		const file = new File(['<A/>'], 'a.xml')
		expect(await outcomeOf(client.api.importFile({ file, writeId: 'import-1' }))).toEqual({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'import-1' },
		})
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(calls.map((call) => call.member)).toEqual(['importFile'])
	})
})
