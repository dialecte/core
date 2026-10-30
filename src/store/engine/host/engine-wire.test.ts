import { serveClient } from './engine-wire'
import { createHeartbeat } from './heartbeat'
import { LARGE_ANSWER_RECORDS } from './host.constants'

import * as Comlink from 'comlink'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { EngineApi } from '../engine.types'
import type { EngineWire, WireAnswer } from '../wire/wire.types'
import type { StoreEvents } from './host.types'
import type { DialecteError } from '@/errors'

/** What a case leaves: its ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const QUIET_EVENTS: StoreEvents = {
	announce: function announceNothing() {},
	close: function closeNothing() {},
}

/** A served port answering `getByDocumentId` with `count` records; every message the client side saw, in order. */
function servedRead(params: { count: number }): { read: () => Promise<unknown>; seen: string[] } {
	const channel = new MessageChannel()
	const heartbeat = createHeartbeat({ intervalMs: 60_000 })
	heartbeat.add(channel.port2)
	const records = Array.from({ length: params.count }, (_, index) => ({ id: `r${index}` }))
	const view = { getByDocumentId: () => Promise.resolve(records) } as unknown as EngineApi
	serveClient({ port: channel.port2, clientId: 'a', view, events: QUIET_EVENTS, heartbeat })
	const seen: string[] = []
	channel.port1.addEventListener('message', function record(event: MessageEvent) {
		const type = (event.data as { type?: string } | undefined)?.type
		seen.push(type === 'busy' || type === 'heartbeat' ? type : 'answer')
	})
	const remote = Comlink.wrap<EngineWire>(channel.port1)
	cleanups.push(
		() => channel.port1.close(),
		() => channel.port2.close(),
	)
	return {
		read: () => remote.call({ member: 'getByDocumentId', args: ['doc-1'], standIns: [] }),
		seen,
	}
}

describe('an answer cloned onto the port', () => {
	it(`${LARGE_ANSWER_RECORDS} records → busy told before it, a beat after it`, async () => {
		const { read, seen } = servedRead({ count: LARGE_ANSWER_RECORDS })
		await read()
		await vi.waitFor(function beatSeen() {
			expect(seen).toEqual(['busy', 'answer', 'heartbeat'])
		})
	})

	it(`${LARGE_ANSWER_RECORDS - 1} records → the answer alone`, async () => {
		const { read, seen } = servedRead({ count: LARGE_ANSWER_RECORDS - 1 })
		await read()
		await vi.waitFor(function answerSeen() {
			expect(seen).toEqual(['answer'])
		})
		// no beat follows: a bounded wait, longer than a message takes on a loaded machine
		await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
		expect(seen).toEqual(['answer'])
	})
})

/** A served port whose engine answers `answer` (or throws `thrown`); the client's raw answer envelope. */
function servedCall(params: { answer?: unknown; thrown?: unknown }): () => Promise<WireAnswer> {
	const channel = new MessageChannel()
	const heartbeat = createHeartbeat({ intervalMs: 60_000 })
	const view = {
		getDocuments: function answerOrThrow() {
			return 'thrown' in params ? Promise.reject(params.thrown) : Promise.resolve(params.answer)
		},
	} as unknown as EngineApi
	serveClient({ port: channel.port2, clientId: 'a', view, events: QUIET_EVENTS, heartbeat })
	const remote = Comlink.wrap<EngineWire>(channel.port1)
	cleanups.push(
		() => channel.port1.close(),
		() => channel.port2.close(),
	)
	return () => remote.call({ member: 'getDocuments', args: [], standIns: [] })
}

describe('an answer that does not clone as it is', () => {
	it('a value holding a function → refused as the port refused it (as data), nothing of the value', async () => {
		function fix(): number {
			return 1
		}
		const call = servedCall({ answer: { applied: true, diagnostics: [{ meta: { fix } }] } })
		const answer = await call()
		expect(answer.ok).toBe(false)
		expect(answer.ok === false && answer.thrown).toMatchObject({
			kind: 'error',
			name: 'DataCloneError',
		})
	})

	it('a structured error whose ref holds a function → refused as the error, its ref made clonable', async () => {
		function locate(): string {
			return 'here'
		}
		const thrown = createDialecteError('ASSERTION_FAILED', {
			detail: 'a ref that does not clone',
			ref: { locate } as unknown as DialecteError['ref'],
		})
		const answer = await servedCall({ thrown })()
		expect(answer.ok).toBe(false)
		expect(answer.ok === false && answer.thrown).toMatchObject({
			kind: 'dialecte',
			error: { key: 'ASSERTION_FAILED', ref: { locate: String(locate) } },
		})
	})
})

describe('progress told while a call runs', () => {
	it('a listener taking time over each tick → the answer comes once the last tick has been told', async () => {
		const channel = new MessageChannel()
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		const view = {
			commit: function commitTelling(
				_params: unknown,
				onProgress: (current: number, total: number) => void,
			) {
				for (let current = 1; current <= 3; current += 1) onProgress(current, 3)
				return Promise.resolve()
			},
		} as unknown as EngineApi
		serveClient({ port: channel.port2, clientId: 'a', view, events: QUIET_EVENTS, heartbeat })
		const remote = Comlink.wrap<EngineWire>(channel.port1)
		cleanups.push(
			() => channel.port1.close(),
			() => channel.port2.close(),
		)
		const told: number[] = []
		const listener = Comlink.proxy(async function slowListener(...progress: unknown[]) {
			await new Promise((resolve) => setTimeout(resolve, 50))
			told.push(progress[0] as number)
		})
		await remote.call({ member: 'commit', args: [{ documentId: 'doc-1' }], standIns: [] }, listener)
		expect(told).toEqual([1, 2, 3])
	})
})
