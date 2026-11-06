import { ENGINE_SIGNAL } from '../engine.constants'
import { createEngineClient } from './engine-client'
import { outcomeOf, watchedClient } from './engine-client.fixtures'

import * as Comlink from 'comlink'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { quietReports, reportedFailures } from '@/utils/tell-listener.fixtures'

import type { ProgressSignal } from '../host/host.types'
import type { EngineWire, WireRequest } from '../wire/wire.types'
import type { EngineClient } from './client.types'

/** What a case leaves: its clients closed, its fake engines' ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function busyWait(params: { ms: number }): void {
	const until = performance.now() + params.ms
	while (performance.now() < until);
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
		const { client, engineSide } = watchedClient({ cleanups })
		documentsOnlyEngine({ port: engineSide })
		const waiting = outcomeOf(client.api.getByDocumentId('doc-1'))
		engineSide.postMessage({ type: ENGINE_SIGNAL.busy })
		const documents = await client.api.getDocuments()
		expect(documents).toEqual([])
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
		const outcome = await waiting
		expect(outcome).toEqual({ key: 'STORE_CONNECTION_LOST', meta: { reason: 'no-heartbeat' } })
	})

	it('its page stalled past the timeout while a beat waited → no loss: the beat is read first; silent after → lost', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		const calling = outcomeOf(client.api.getDocuments())
		engineSide.postMessage({ type: 'heartbeat' })
		busyWait({ ms: 500 })
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 150)),
		])
		expect(early).toBe('waiting')
		const outcome = await calling
		expect(outcome).toEqual({ key: 'STORE_CONNECTION_LOST', meta: { reason: 'no-heartbeat' } })
	})

	it('a call lost for no heartbeat → refused STORE_CONNECTION_LOST with the code D1018, its reason in the meta', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		silentEngine({ port: engineSide })
		const thrown = await client.api.getDocuments().catch((error: unknown) => error)
		const refusal = toDialecteError(thrown)
		expect({ key: refusal?.key, code: refusal?.code, meta: refusal?.meta }).toEqual({
			key: 'STORE_CONNECTION_LOST',
			code: 'D1018',
			meta: { reason: 'no-heartbeat' },
		})
	})

	it('an export lost for no heartbeat → the engine told to abort it, by its id', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		const calls = silentEngine({ port: engineSide })
		const exporting = client.api.exportFile({ documentId: 'doc-1', exportId: 'export-1' })
		const outcome = await outcomeOf(exporting)
		expect(outcome).toEqual({ key: 'STORE_CONNECTION_LOST', meta: { reason: 'no-heartbeat' } })
		await vi.waitFor(function abortAsked() {
			expect(calls.map((call) => [call.member, call.args])).toContainEqual([
				'abortExport',
				[{ exportId: 'export-1' }],
			])
		})
	})

	it('an import lost for no heartbeat → not aborted: a write may still apply, its outcome asked later', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		const calls = silentEngine({ port: engineSide })
		const file = new File(['<A/>'], 'a.xml')
		const outcome = await outcomeOf(client.api.importFile({ file, writeId: 'import-1' }))
		expect(outcome).toEqual({
			key: 'STORE_CONNECTION_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'import-1' },
		})
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(calls.map((call) => call.member)).toEqual(['importFile'])
	})
})

/** What one commit of a fake engine is: its progress id, and how to tick or answer it. */
type HeldCommit = {
	progressId: number | undefined
	tick: (params: { current: number }) => void
	answer: () => void
}

/** An engine holding every commit until the case ticks and answers it, on the engine's side of the port. */
function holdingEngine(params: { port: MessagePort }): HeldCommit[] {
	const { port } = params
	const held: HeldCommit[] = []
	const wire: EngineWire = {
		call: function holdCall(request) {
			return new Promise(function holdUntilAnswered(resolve) {
				held.push({
					progressId: request.progressId,
					tick: function postTick({ current }) {
						const signal: ProgressSignal = {
							type: ENGINE_SIGNAL.progress,
							progressId: request.progressId!,
							progress: [current, 3],
						}
						port.postMessage(signal)
					},
					answer: function answerCall() {
						resolve({ ok: true, value: undefined })
					},
				})
			})
		},
	}
	Comlink.expose(wire, port)
	return held
}

function commitOf(params: { client: EngineClient; heard: number[] }): Promise<void> {
	return params.client.api.commit(
		{ documentId: 'doc-1', operations: [] } as never,
		function hearProgress(current: number) {
			params.heard.push(current)
		},
	)
}

/** The fake engine's held commits, once `count` of them have reached it. */
async function heldCommits(params: { held: HeldCommit[]; count: number }): Promise<HeldCommit[]> {
	await vi.waitFor(function commitsReached() {
		expect(params.held).toHaveLength(params.count)
	})
	return params.held
}

describe('a client hearing its calls’ progress', () => {
	it('two calls in flight → each listener hears only its own ticks, every one before its call’s answer', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		const held = holdingEngine({ port: engineSide })
		const first: number[] = []
		const second: number[] = []
		const firstCall = commitOf({ client, heard: first })
		const secondCall = commitOf({ client, heard: second })
		const [one, two] = await heldCommits({ held, count: 2 })
		one!.tick({ current: 1 })
		two!.tick({ current: 10 })
		one!.tick({ current: 2 })
		one!.answer()
		await firstCall
		expect(first).toEqual([1, 2])
		two!.tick({ current: 20 })
		two!.answer()
		await secondCall
		expect(second).toEqual([10, 20])
	})

	it('a listener that throws, or answers a promise that rejects → its call answered all the same, each failure reported', async () => {
		const reports = quietReports()
		const failed = new Error('the caller’s listener failed')
		const failedLater = new Error('the caller’s listener failed later')
		const { client, engineSide } = watchedClient({ cleanups })
		const held = holdingEngine({ port: engineSide })
		const throwing = client.api.commit(
			{ documentId: 'doc-1', operations: [] } as never,
			function fail() {
				throw failed
			},
		)
		const rejecting = client.api.commit(
			{ documentId: 'doc-1', operations: [] } as never,
			async function failLater() {
				throw failedLater
			},
		)
		const [one, two] = await heldCommits({ held, count: 2 })
		one!.tick({ current: 1 })
		two!.tick({ current: 1 })
		one!.answer()
		two!.answer()
		const outcomes = await Promise.all([outcomeOf(throwing), outcomeOf(rejecting)])
		expect(outcomes).toEqual(['resolved', 'resolved'])
		await vi.waitFor(function bothReported() {
			expect(new Set(reportedFailures({ reports }))).toEqual(new Set([failed, failedLater]))
		})
	})

	it('a tick after the client lost its engine → told to nobody', async () => {
		const { client, engineSide } = watchedClient({ cleanups })
		const held = holdingEngine({ port: engineSide })
		const heard: number[] = []
		const calling = outcomeOf(commitOf({ client, heard }))
		const [one] = await heldCommits({ held, count: 1 })
		one!.tick({ current: 1 })
		await vi.waitFor(function firstTickHeard() {
			expect(heard).toEqual([1])
		})
		client.lose({ reason: 'host-gone' })
		one!.tick({ current: 2 })
		// a later call's tick, heard: the port's order says the lost call's tick came through first
		const later: number[] = []
		const laterCall = commitOf({ client, heard: later })
		const [, two] = await heldCommits({ held, count: 2 })
		two!.tick({ current: 9 })
		await vi.waitFor(function laterTickHeard() {
			expect(later).toEqual([9])
		})
		expect(heard).toEqual([1])
		two!.answer()
		await laterCall
		const outcome = await calling
		expect(outcome).toEqual({ key: 'STORE_CONNECTION_LOST', meta: { reason: 'host-gone' } })
	})

	it('closed → every listener it put on the port taken off', () => {
		const channel = new MessageChannel()
		const added: EventListenerOrEventListenerObject[] = []
		const removed: EventListenerOrEventListenerObject[] = []
		const addListener = channel.port1.addEventListener.bind(channel.port1)
		const removeListener = channel.port1.removeEventListener.bind(channel.port1)
		channel.port1.addEventListener = function recordAdd(
			type: string,
			listener: EventListenerOrEventListenerObject,
		) {
			if (type === 'message') added.push(listener)
			addListener(type, listener)
		} as MessagePort['addEventListener']
		channel.port1.removeEventListener = function recordRemove(
			type: string,
			listener: EventListenerOrEventListenerObject,
		) {
			if (type === 'message') removed.push(listener)
			removeListener(type, listener)
		} as MessagePort['removeEventListener']
		const client = createEngineClient({ port: channel.port1 })
		client.close({ storeName: 'closed' })
		channel.port2.close()
		// every listener taken off but Comlink's own, which goes with the port it closes
		const left = added.filter(function stillOn(listener) {
			return !removed.includes(listener)
		})
		expect(added.length).toBeGreaterThanOrEqual(3)
		expect(left).toHaveLength(1)
	})
})
