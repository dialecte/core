import { writeAround } from './bypass-write'
import { expectSnapshot } from './expect-snapshot'
import { gateStore } from './gated-store'
import { installLossyChannel } from './lossy-channel'
import {
	aBOf,
	bWith,
	closeTracked,
	trackedOfFile,
	observed,
	openSource,
} from './read-model-harness.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { StoreNotice } from '@/store/store.types'

// The harness's holds made visible and released, answers held past a change, snapshots never going back.

const tracked = trackedOfFile()
const { restores } = tracked

afterEach(async () => {
	await closeTracked()
})

describe('read-model harness - holds made visible, released at the end', () => {
	it('notices held, the store tells one → the hold is reached', async () => {
		const { store, documentId } = await openSource()
		const update = await bWith({ store, documentId, value: 'one' })
		async function holdThenCommit() {
			const gate = gateStore({ store })
			const subscribe = gate.store.subscribe
			if (!subscribe) throw new Error('the in-memory store announces')
			restores.push(subscribe.call(gate.store, function ignore() {}))
			const held = gate.holdNotices()
			await writeAround({ store, documentId, updates: [update] })
			await held.reached
			return 'reached'
		}
		await expect(observed(holdThenCommit)).resolves.toBe('reached')
	})

	it('a call and notices held, everything released → the call answers, the notice told', async () => {
		const { store, documentId } = await openSource()
		const update = await bWith({ store, documentId, value: 'one' })
		async function holdThenReleaseAll() {
			const gate = gateStore({ store })
			const told: string[] = []
			const subscribe = gate.store.subscribe
			if (!subscribe) throw new Error('the in-memory store announces')
			restores.push(
				subscribe.call(gate.store, function keep(notice: StoreNotice) {
					if (notice.type === 'change') told.push(notice.message.type)
				}),
			)
			const heldCall = gate.hold({ member: 'getMany' })
			const notices = gate.holdNotices()
			const answer = gate.store.getMany(['b'], documentId)
			await heldCall.reached
			await writeAround({ store, documentId, updates: [update] })
			await notices.reached
			gate.releaseAll()
			const records = await answer
			return { answered: records.map(aBOf), told }
		}
		await expect(observed(holdThenReleaseAll)).resolves.toEqual({
			answered: ['one'],
			told: ['commit'],
		})
	})

	it('a message type dropped, one posted → the drop is reached', async () => {
		async function dropThenPost() {
			const lossy = installLossyChannel()
			restores.push(lossy.restore)
			const sender = new BroadcastChannel(`lossy-${crypto.randomUUID()}`)
			restores.push(() => sender.close())
			const dropped = lossy.drop({ type: 'commit' })
			sender.postMessage({
				type: 'commit',
				documentId: 'lost',
				timestamp: 1,
				changeId: 'lost',
				changes: { unknown: true },
			})
			await dropped.reached
			return 'reached'
		}
		await expect(observed(dropThenPost)).resolves.toBe('reached')
	})

	it('messages held, the channel restored, then flushed → nothing posted, nothing thrown', async () => {
		async function holdRestoreFlush() {
			const lossy = installLossyChannel()
			const name = `lossy-${crypto.randomUUID()}`
			const heard: unknown[] = []
			const listener = new BroadcastChannel(name)
			listener.onmessage = function keep(event: MessageEvent) {
				heard.push(event.data)
			}
			restores.push(() => listener.close())
			const sender = new BroadcastChannel(name)
			lossy.hold({ type: 'commit' })
			sender.postMessage({
				type: 'commit',
				documentId: 'held',
				timestamp: 1,
				changeId: 'held',
				changes: { unknown: true },
			})
			sender.close()
			lossy.restore()
			lossy.flush()
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			return heard.length
		}
		await expect(observed(holdRestoreFlush)).resolves.toBe(0)
	})
})

describe('read-model harness - answers held, snapshots ordered', () => {
	it('an answer held, the store written meanwhile → the answer read before the write, given when released', async () => {
		const { store, documentId } = await openSource()
		const update = await bWith({ store, documentId, value: 'after' })
		async function holdTheAnswer() {
			const gate = gateStore({ store })
			const held = gate.holdAnswer({ member: 'get' })
			const answer = gate.store.get('b', documentId)
			await held.reached
			await writeAround({ store, documentId, updates: [update] })
			held.release()
			const record = await answer
			return aBOf(record)
		}
		await expect(observed(holdTheAnswer)).resolves.toBe('first')
	})

	it('an answer of an older point than one the session gave before → the snapshot assertion fails', async () => {
		function assertGoingBack() {
			try {
				expectSnapshot({
					answer: 'first',
					trail: { answers: ['first', 'second'], record: noRecord },
					from: 0,
					notBefore: 'second',
				})
				return 'passed'
			} catch {
				return 'failed'
			}
		}
		await expect(observed(assertGoingBack)).resolves.toBe('failed')
	})

	it('a subscribe through the gate → counted', async () => {
		const { store } = await openSource()
		async function subscribeThrough() {
			const gate = gateStore({ store })
			const subscribe = gate.store.subscribe
			if (!subscribe) throw new Error('the in-memory store announces')
			restores.push(subscribe.call(gate.store, function ignore() {}))
			return gate.counts.get('subscribe')
		}
		await expect(observed(subscribeThrough)).resolves.toBe(1)
	})

	it('two message types dropped, one of each posted → each drop reached', async () => {
		async function dropTwoTypes() {
			const lossy = installLossyChannel()
			restores.push(lossy.restore)
			const sender = new BroadcastChannel(`lossy-${crypto.randomUUID()}`)
			restores.push(() => sender.close())
			const commits = lossy.drop({ type: 'commit' })
			const updates = lossy.drop({ type: 'document-updated' })
			sender.postMessage({
				type: 'commit',
				documentId: 'lost',
				timestamp: 1,
				changeId: 'lost',
				changes: { unknown: true },
			})
			sender.postMessage({ type: 'document-updated', documentId: 'lost', timestamp: 1 })
			const timeout = new Promise((resolve) =>
				setTimeout(() => resolve('timed out'), SILENCE_WAIT_MS),
			)
			return Promise.race([
				Promise.all([commits.reached, updates.reached]).then(() => 'both reached'),
				timeout,
			])
		}
		await expect(observed(dropTwoTypes)).resolves.toBe('both reached')
	})
})

async function noRecord(): Promise<void> {}
