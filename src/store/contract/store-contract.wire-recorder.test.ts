import { recordingConnector } from './store-contract.wire-recorder'

import { describe, expect, it } from 'vitest'

import type {
	EngineConnector,
	EngineDestroyParams,
	EngineLink,
} from '../sqlite/served/engine-store.types'
import type { EngineApi } from '../sqlite/served/engine.types'

/** What the fake connector saw: the destroys with what they were given, the closes and the notice listeners. */
type FakeConnectorSeen = {
	destroys: (EngineDestroyParams | undefined)[]
	closes: number
	noticeListeners: number
	inner: EngineLink[]
}

/**
 * A connector whose engine answers `count` and `get` with fixed values and refuses `removeDocument`; it keeps every
 * link it made and notes the destroys, closes and notice listeners it is given.
 */
function fakeConnector(): EngineConnector & {
	destroyed: number
	links: number
	seen: FakeConnectorSeen
} {
	const seen: FakeConnectorSeen = { destroys: [], closes: 0, noticeListeners: 0, inner: [] }
	const engine = {
		removeDocument: async function removeDocument() {
			throw new Error('refused by the engine')
		},
		count: async function count() {
			return 3
		},
		get: async function get(id: string, documentId: string) {
			return { id, documentId }
		},
	} as unknown as EngineApi
	const connector = {
		destroyed: 0,
		links: 0,
		seen,
		connect: async function connect(): Promise<EngineLink> {
			connector.links += 1
			const link: EngineLink = {
				engine: async function linkedEngine() {
					return engine
				},
				connectionId: `connection-${connector.links}`,
				onNotice: function onNotice() {
					seen.noticeListeners += 1
					return function unsubscribe() {}
				},
				close: async function close() {
					seen.closes += 1
				},
			}
			seen.inner.push(link)
			return link
		},
		destroy: async function destroy(params?: EngineDestroyParams) {
			connector.destroyed += 1
			seen.destroys.push(params)
		},
	}
	return connector
}

/** A link's engine through a recording connector, and what it noted. */
async function recordedEngine(): Promise<{ engine: EngineApi; called: Set<keyof EngineApi> }> {
	const called = new Set<keyof EngineApi>()
	const link = await recordingConnector({ connector: fakeConnector(), called }).connect()
	const engine = await link.engine()
	return { engine, called }
}

/** Two engines of one link through a recording connector, then its destroy: what passed through and was noted. */
async function twoEnginesThenDestroy(): Promise<{
	connectionId: string
	destroyed: number
	called: string[]
}> {
	const called = new Set<keyof EngineApi>()
	const connector = fakeConnector()
	const recording = recordingConnector({ connector, called })
	const link = await recording.connect()
	const first = await link.engine()
	await first.count('document')
	const second = await link.engine()
	await second.get('b', 'document')
	await recording.destroy()
	return {
		connectionId: link.connectionId,
		destroyed: connector.destroyed,
		called: [...called].sort(),
	}
}

/** Two calls on a recorded engine: their answers and what was noted. */
async function twoCalls(): Promise<{ count: number; get: unknown; called: string[] }> {
	const { engine, called } = await recordedEngine()
	const count = await engine.count('document')
	const get = await engine.get('a', 'document')
	return { count, get, called: [...called].sort() }
}

/** A member of a recorded engine read, never called: whether it is a function, and what was noted. */
async function memberRead(): Promise<{ isFunction: boolean; called: string[] }> {
	const { engine, called } = await recordedEngine()
	return { isFunction: typeof engine.count === 'function', called: [...called] }
}

describe('recordingConnector', () => {
	it("every member called on the link's engine is noted, its answer passed through untouched", async () => {
		await expect(twoCalls()).resolves.toEqual({
			count: 3,
			get: { id: 'a', documentId: 'document' },
			called: ['count', 'get'],
		})
	})

	it('a member only read, never called, is not noted', async () => {
		await expect(memberRead()).resolves.toEqual({ isFunction: true, called: [] })
	})

	it("the link's id, a later engine of the link and the connector's destroy pass through", async () => {
		await expect(twoEnginesThenDestroy()).resolves.toEqual({
			connectionId: 'connection-1',
			destroyed: 1,
			called: ['count', 'get'],
		})
	})

	it('a destroy given the recorded link as its own reaches the inner connector with the link it made, the same letGo', async () => {
		await expect(destroyWithOwnLink()).resolves.toEqual({ sameLink: true, sameLetGo: true })
	})

	it("the link's close and notice listeners reach the inner link", async () => {
		await expect(closeAndListen()).resolves.toEqual({ closes: 1, noticeListeners: 1 })
	})

	it('a call the engine refuses is noted, its refusal passed through', async () => {
		await expect(refusedCall()).resolves.toEqual({
			refusal: 'refused by the engine',
			called: ['removeDocument'],
		})
	})
})

/** A destroy through the recording connector naming its own recorded link: what the inner connector was handed. */
async function destroyWithOwnLink(): Promise<{ sameLink: boolean; sameLetGo: boolean }> {
	const connector = fakeConnector()
	const recording = recordingConnector({ connector, called: new Set() })
	const link = await recording.connect()
	async function letGo(): Promise<void> {}
	await recording.destroy({ own: { link, letGo } })
	const given = connector.seen.destroys[0]
	return {
		sameLink: given?.own?.link === connector.seen.inner[0],
		sameLetGo: given?.own?.letGo === letGo,
	}
}

/** The recorded link closed after a notice listener was added: what the inner link saw. */
async function closeAndListen(): Promise<{ closes: number; noticeListeners: number }> {
	const connector = fakeConnector()
	const link = await recordingConnector({ connector, called: new Set() }).connect()
	link.onNotice(function ignoreNotice() {})
	await link.close()
	return { closes: connector.seen.closes, noticeListeners: connector.seen.noticeListeners }
}

/** A member the engine refuses, called through a recorded engine: the refusal, and what was noted. */
async function refusedCall(): Promise<{ refusal: string; called: string[] }> {
	const { engine, called } = await recordedEngine()
	const refusal = await engine.removeDocument('document').then(
		function answered() {
			return 'answered'
		},
		function refused(error: unknown) {
			return error instanceof Error ? error.message : String(error)
		},
	)
	return { refusal, called: [...called] }
}
