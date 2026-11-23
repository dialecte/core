import { writeAround } from './bypass-write'
import { gateStore } from './gated-store'
import { installLossyChannel } from './lossy-channel'
import { openRawStore } from './raw-store'
import {
	aBOf,
	bWith,
	closeTracked,
	trackedOfFile,
	inMemoryStorage,
	observed,
	openSource,
} from './read-model-harness.fixtures'
import { answerUncached } from './uncached-answer'
import { createVersionTrail } from './version-trail'

import { afterEach, describe, expect, it } from 'vitest'

import { SWITCH_CONFIG, SWITCH_DIALECTE_ID } from '@/project/store-switch.fixtures'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { Query } from '@/document/query/main'
import type { ProjectChannelMessage } from '@/project/types'
import type { StoreNotice } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

// The harness's own parts, on the in-memory store: a gate holds a call or the notices, the lossy channel drops or holds
// a message, a write goes around the projects, the uncached answer keeps nothing, the trail keeps each answer.

const tracked = trackedOfFile()
const { restores, stores } = tracked

afterEach(async () => {
	await closeTracked()
})

describe('read-model harness - a gated store', () => {
	it('a held member call → waits until released, then answers as the store does', async () => {
		const { store, documentId } = await openSource()
		async function holdThenRelease() {
			const gate = gateStore({ store })
			const held = gate.hold({ member: 'get' })
			const settled: string[] = []
			const answer = gate.store.get('b', documentId).then(function noteSettled(record) {
				settled.push('settled')
				return record
			})
			await held.reached
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			const beforeRelease = [...settled]
			held.release()
			const record = await answer
			return { beforeRelease, answered: aBOf(record) }
		}
		await expect(observed(holdThenRelease)).resolves.toEqual({
			beforeRelease: [],
			answered: 'first',
		})
	})

	it('calls of each member → counted', async () => {
		const { store, documentId } = await openSource()
		async function callThrough() {
			const gate = gateStore({ store })
			await gate.store.get('b', documentId)
			await gate.store.get('root', documentId)
			await gate.store.getMany(['b'], documentId)
			return Object.fromEntries(gate.counts)
		}
		await expect(observed(callThrough)).resolves.toMatchObject({ get: 2, getMany: 1 })
	})

	it('notices held → told when released, in the order the store told them', async () => {
		const { store, documentId } = await openSource()
		const firstWrite = await bWith({ store, documentId, value: 'one' })
		async function holdNotices() {
			const gate = gateStore({ store })
			const told: string[] = []
			const subscribe = gate.store.subscribe
			if (!subscribe) throw new Error('the in-memory store announces')
			const stop = subscribe.call(gate.store, function keep(notice: StoreNotice) {
				if (notice.type === 'change') told.push(notice.message.type)
			})
			restores.push(stop)
			gate.holdNotices()
			await store.commit({
				documentId,
				writeId: crypto.randomUUID(),
				creates: [],
				updates: [firstWrite],
				deletes: [],
				onProgress: function ignoreProgress() {},
			})
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			const whileHeld = [...told]
			gate.releaseNotices()
			return { whileHeld, released: told }
		}
		await expect(observed(holdNotices)).resolves.toEqual({ whileHeld: [], released: ['commit'] })
	})
})

describe('read-model harness - a lossy channel', () => {
	function listen(name: string): ProjectChannelMessage[] {
		const heard: ProjectChannelMessage[] = []
		const channel = new BroadcastChannel(name)
		channel.onmessage = function keep(event: MessageEvent<ProjectChannelMessage>) {
			heard.push(event.data)
		}
		restores.push(() => channel.close())
		return heard
	}

	function commitMessage(documentId: string): ProjectChannelMessage {
		return {
			type: 'commit',
			documentId,
			timestamp: 1,
			changeId: documentId,
			changes: { unknown: true },
		}
	}

	it('a dropped message type → never reaches the other channel, another type does', async () => {
		async function dropCommits() {
			const lossy = installLossyChannel()
			restores.push(lossy.restore)
			const name = `lossy-${crypto.randomUUID()}`
			const heard = listen(name)
			const sender = new BroadcastChannel(name)
			restores.push(() => sender.close())
			lossy.drop({ type: 'commit' })
			sender.postMessage(commitMessage('lost'))
			sender.postMessage({ type: 'document-updated', documentId: 'kept', timestamp: 1 })
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			return heard.map((told) => told.type)
		}
		await expect(observed(dropCommits)).resolves.toEqual(['document-updated'])
	})

	it('held messages flushed reversed → reach the other channel, the last held first', async () => {
		async function holdThenFlush() {
			const lossy = installLossyChannel()
			restores.push(lossy.restore)
			const name = `lossy-${crypto.randomUUID()}`
			const heard = listen(name)
			const sender = new BroadcastChannel(name)
			restores.push(() => sender.close())
			lossy.hold({ type: 'commit' })
			sender.postMessage(commitMessage('first'))
			sender.postMessage(commitMessage('second'))
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			const whileHeld = heard.length
			lossy.flush({ reversed: true })
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
			return {
				whileHeld,
				flushed: heard.map((told) => ('documentId' in told ? told.documentId : '')),
			}
		}
		await expect(observed(holdThenFlush)).resolves.toEqual({
			whileHeld: 0,
			flushed: ['second', 'first'],
		})
	})

	it('the channel restored → the realm’s own BroadcastChannel again', async () => {
		function installThenRestore() {
			const own = globalThis.BroadcastChannel
			const lossy = installLossyChannel()
			const replaced = globalThis.BroadcastChannel !== own
			lossy.restore()
			return { replaced, restored: globalThis.BroadcastChannel === own }
		}
		await expect(observed(installThenRestore)).resolves.toEqual({ replaced: true, restored: true })
	})
})

describe('read-model harness - writes around the projects, uncached answers, the trail', () => {
	it('a write around the projects → lands in the store', async () => {
		const { store, documentId } = await openSource()
		const around = await bWith({ store, documentId, value: 'around' })
		async function writeThenRead() {
			await writeAround({ store, documentId, updates: [around] })
			const stored = await store.get('b', documentId)
			return aBOf(stored)
		}
		await expect(observed(writeThenRead)).resolves.toBe('around')
	})

	it('a read asked uncached twice → the store read twice, the same answer', async () => {
		const { store, documentId } = await openSource()
		async function readTwice() {
			const gate = gateStore({ store })
			const params = {
				store: gate.store,
				config: SWITCH_CONFIG,
				documentId,
				read: function readB(query: Query<AnyDialecteConfig>) {
					return query.getAttribute({ tagName: 'B', id: 'b' }, { name: 'aB' })
				},
			}
			const first = await answerUncached(params)
			const second = await answerUncached(params)
			return { first, second, gets: gate.counts.get('get') ?? 0 }
		}
		await expect(observed(readTwice)).resolves.toEqual({ first: 'first', second: 'first', gets: 2 })
	})

	it('a point recorded after each write → the uncached answers in order', async () => {
		const { store, documentId } = await openSource()
		const second = await bWith({ store, documentId, value: 'second' })
		async function recordAroundAWrite() {
			const trail = createVersionTrail({
				answer: function aBNow() {
					return store.get('b', documentId).then(aBOf)
				},
			})
			await trail.record()
			await writeAround({ store, documentId, updates: [second] })
			await trail.record()
			return trail.answers
		}
		await expect(observed(recordAroundAWrite)).resolves.toEqual(['first', 'second'])
	})

	it('a store of a project’s name → opened, reading what the project imported', async () => {
		const { documentId, name } = await openSource()
		async function openThenRead() {
			const store = await openRawStore({
				storage: inMemoryStorage,
				name,
				dialecteId: SWITCH_DIALECTE_ID,
				config: SWITCH_CONFIG,
			})
			stores.push(store)
			const stored = await store.get('b', documentId)
			return aBOf(stored)
		}
		await expect(observed(openThenRead)).resolves.toBe('first')
	})
})
