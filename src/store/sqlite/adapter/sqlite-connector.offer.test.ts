import { connectHub } from '../../hub-public'
import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import { refuseRealmStorage, restoreRealmStorage } from './realm-storage.fixtures'
import { createSqliteConnector } from './sqlite-connector'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { HubConnectionOptions } from '../../engine/hub/hub-client.types'

/** What the realm asked of the hub: each connection opened (with the engines it offered), and the one it kept. */
const hub = vi.hoisted(function hubOfTheCase() {
	return {
		opened: [] as HubConnectionOptions[],
		kept: undefined as Promise<{ bound: boolean } | undefined> | undefined,
	}
})

vi.mock('../../engine/hub/hub-client', function mockHubClient() {
	return {
		openHubConnection: async function recordOpen(params: HubConnectionOptions) {
			hub.opened.push(params)
			return { bound: false, realmId: () => 'realm', createHubPort: noPort, onRejoined: noPort }
		},
		keptHubConnection: function keptOfTheCase() {
			return hub.kept
		},
		adoptHubConnection: async function notAdopted() {
			return undefined
		},
	}
})

vi.mock('../../engine/client/hub-connector', function mockHubConnector() {
	return {
		createHubConnector: function hubConnector() {
			return {
				connect: async function connectThroughHub() {
					return 'through the hub'
				},
				destroy: async function destroyThroughHub() {
					return 'destroyed through the hub'
				},
			}
		},
	}
})

function noPort(): never {
	throw new Error('not in this case')
}

afterEach(function restoreRealm() {
	hub.opened.splice(0)
	hub.kept = undefined
	restoreRealmStorage()
})

function connector(): ReturnType<typeof createSqliteConnector> {
	return createSqliteConnector({
		name: `offer-${crypto.randomUUID()}`,
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: TEST_DIALECTE.version,
		engineUrl: TEST_ENGINE_URL,
	})
}

/** The dialectes of the engines offered in every connection the realm opened. */
function offeredDialectes(): string[] {
	return hub.opened.flatMap(function dialectesOf({ spawners = [] }) {
		return spawners.map(function dialecteOf(spawner) {
			return spawner.dialecteId
		})
	})
}

async function answerOf(params: { call: () => Promise<unknown> }): Promise<unknown> {
	return params.call().then(
		function answered(value) {
			return value
		},
		function refused(thrown: unknown) {
			return toDialecteError(thrown)?.key
		},
	)
}

describe('the way a project on sqlite goes, by what the realm can store and how it joined the hub', () => {
	type TestCase = {
		storageRefused: boolean
		/** The connection the realm has already: bound by its page, joined on its own, or none. */
		kept?: 'bound' | 'own'
		call: 'connect' | 'destroy'
		expected: { answer: unknown; offered: string[]; connectionsOpened: number }
	}
	const testCases: Record<string, TestCase> = {
		'a realm that can store, connecting → through the hub, its project’s engine offered': {
			storageRefused: false,
			call: 'connect',
			expected: { answer: 'through the hub', offered: [TEST_DIALECTE.id], connectionsOpened: 1 },
		},
		'a child bound by its page whose private file system is refused, connecting → through the hub, no engine offered, no connection of its own':
			{
				storageRefused: true,
				kept: 'bound',
				call: 'connect',
				expected: { answer: 'through the hub', offered: [], connectionsOpened: 0 },
			},
		'a realm joined on its own whose private file system is refused, connecting → STORE_UNAVAILABLE, nothing asked of the hub':
			{
				storageRefused: true,
				kept: 'own',
				call: 'connect',
				expected: { answer: 'STORE_UNAVAILABLE', offered: [], connectionsOpened: 0 },
			},
		'a realm with no hub connection whose private file system is refused, connecting → STORE_UNAVAILABLE, no hub started':
			{
				storageRefused: true,
				call: 'connect',
				expected: { answer: 'STORE_UNAVAILABLE', offered: [], connectionsOpened: 0 },
			},
		'a bound child whose private file system is refused, destroying (a worker of its own deletes the files) → STORE_UNAVAILABLE':
			{
				storageRefused: true,
				kept: 'bound',
				call: 'destroy',
				expected: { answer: 'STORE_UNAVAILABLE', offered: [], connectionsOpened: 0 },
			},
	}
	for (const [description, { storageRefused, kept, call, expected }] of Object.entries(testCases)) {
		it(description, async () => {
			if (storageRefused) refuseRealmStorage()
			if (kept) hub.kept = Promise.resolve({ bound: kept === 'bound' })
			const answer = await answerOf({
				call: function connectOrDestroy() {
					const made = connector()
					return call === 'connect' ? made.connect() : made.destroy()
				},
			})
			expect(answer).toBe(expected.answer)
			expect(offeredDialectes()).toEqual(expected.offered)
			expect(hub.opened).toHaveLength(expected.connectionsOpened)
		})
	}

	type ConnectHubCase = { storageRefused: boolean; offered: string[] }
	const connectHubCases: Record<string, ConnectHubCase> = {
		'connectHub in a page that can store → the dialecte’s engine offered': {
			storageRefused: false,
			offered: [TEST_DIALECTE.id],
		},
		'connectHub in a page whose private file system is refused → no engine offered: it joins as a client':
			{ storageRefused: true, offered: [] },
	}
	for (const [description, { storageRefused, offered }] of Object.entries(connectHubCases)) {
		it(description, async () => {
			if (storageRefused) refuseRealmStorage()
			await connectHub({
				spawners: [
					{
						dialecteId: TEST_DIALECTE.id,
						dialecteVersion: TEST_DIALECTE.version,
						engineUrl: TEST_ENGINE_URL,
					},
				],
			})
			expect(offeredDialectes()).toEqual(offered)
		})
	}
})
