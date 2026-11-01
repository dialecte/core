import { connectHub } from '../../hub-public'
import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import { refuseRealmStorage, restoreRealmStorage } from './realm-storage.fixtures'
import { createSqliteConnector } from './sqlite-connector'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { HubConnectorParams } from '../../engine/client/hub-connector.types'
import type { HubConnectionOptions } from '../../engine/hub/hub-client.types'

/** What the realm asked of the hub: each connection opened (with the engines it named), and the one it kept. */
const hub = vi.hoisted(function hubOfTheCase() {
	return {
		opened: [] as HubConnectionOptions[],
		/** Each connector through the hub made, as asked. */
		connectors: [] as HubConnectorParams[],
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
		createHubConnector: function hubConnector(params: HubConnectorParams) {
			hub.connectors.push(params)
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
	hub.connectors.splice(0)
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

/** The dialectes of the engines named in every connection the realm opened (offered unless `hostsNoEngine`). */
function namedDialectes(): string[] {
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
		expected: {
			answer: unknown
			offered: string[]
			connectionsOpened: number
			/** Whether the connector made deletes the project's files in this realm (a destroy through the hub). */
			deletesFiles?: boolean
		}
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
		'a realm that can store, destroying → through the hub, its files deleted here': {
			storageRefused: false,
			call: 'destroy',
			expected: {
				answer: 'destroyed through the hub',
				offered: [TEST_DIALECTE.id],
				connectionsOpened: 1,
				deletesFiles: true,
			},
		},
		'a bound child whose private file system is refused, destroying → through the hub, its files deleted by a view that can store':
			{
				storageRefused: true,
				kept: 'bound',
				call: 'destroy',
				expected: {
					answer: 'destroyed through the hub',
					offered: [],
					connectionsOpened: 0,
					deletesFiles: false,
				},
			},
		'a realm joined on its own whose private file system is refused, destroying → STORE_UNAVAILABLE, nothing asked of the hub':
			{
				storageRefused: true,
				kept: 'own',
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
			expect(namedDialectes()).toEqual(expected.offered)
			expect(hub.opened).toHaveLength(expected.connectionsOpened)
			if (expected.deletesFiles !== undefined) {
				expect(
					hub.connectors.map(function deletesHere(made) {
						return made.deletesFiles ?? true
					}),
				).toEqual([expected.deletesFiles])
			}
		})
	}

	type ConnectHubCase = { storageRefused: boolean; hostsNoEngine: boolean }
	const connectHubCases: Record<string, ConnectHubCase> = {
		'connectHub in a page that can store → the dialecte’s engine offered': {
			storageRefused: false,
			hostsNoEngine: false,
		},
		'connectHub in a page whose private file system is refused → its spawners checked, none offered (it hosts no engine)':
			{ storageRefused: true, hostsNoEngine: true },
	}
	for (const [description, { storageRefused, hostsNoEngine }] of Object.entries(connectHubCases)) {
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
			expect(namedDialectes()).toEqual([TEST_DIALECTE.id])
			expect(
				hub.opened.map(function hostsNone(opened) {
					return opened.hostsNoEngine
				}),
			).toEqual([hostsNoEngine])
		})
	}
})
