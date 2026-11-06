import { connectHub } from '../hub-public'
import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import { SECOND_FIXTURE_DIALECTE } from '../runtime/runtime.fixtures.dialectes.constants'
import { refuseRealmStorage, restoreRealmStorage } from './realm-storage.fixtures'
import { createSqliteConnector } from './sqlite-connector'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { withSqliteEngine, withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { TEST_DIALECTE } from '@/test'

import type { HubConnectorParams } from '../served/client/hub-connector.types'
import type { HubConnectionOptions } from '../served/hub/hub-client.types'
import type { SqliteEngineRegistration } from '../sqlite-storage.types'

/** What the realm asked of the hub: each connection opened (with the engines it named), and the one it kept. */
const hub = vi.hoisted(function hubOfTheCase() {
	return {
		opened: [] as HubConnectionOptions[],
		/** Each connector through the hub made, as asked. */
		connectors: [] as HubConnectorParams[],
		kept: undefined as Promise<{ bound: boolean } | undefined> | undefined,
	}
})

vi.mock('../served/hub/hub-client', function mockHubClient() {
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

vi.mock('../served/client/hub-connector', function mockHubConnector() {
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

/** What the app registered, by case: the test dialecte served beside another one of the same worker, or none. */
type Registered = 'two dialectes' | 'another dialecte only' | 'none'

function registrationOf(params: { registered: Registered }): SqliteEngineRegistration | undefined {
	const { registered } = params
	if (registered === 'none') return undefined
	return {
		url: TEST_ENGINE_URL,
		dialectes:
			registered === 'two dialectes'
				? [TEST_DIALECTE, SECOND_FIXTURE_DIALECTE]
				: [SECOND_FIXTURE_DIALECTE],
	}
}

/** The engine registered for the case (the global kind carries it, as `connectHub` reads it). */
function withRegistered(params: { registered: Registered }): void {
	const registration = registrationOf(params)
	if (registration) withSqliteEngine(registration)
	else withSqliteStorage()
}

function connector(params: {
	registered?: Registered
	perf?: boolean
	dialecteVersion?: string
}): ReturnType<typeof createSqliteConnector> {
	const registration = registrationOf({ registered: params.registered ?? 'two dialectes' })
	return createSqliteConnector({
		name: `offer-${crypto.randomUUID()}`,
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: params.dialecteVersion ?? TEST_DIALECTE.version,
		perf: params.perf,
		engine: function registeredEngine() {
			return registration
		},
	})
}

/** The dialectes of the engines named in every connection the realm opened (offered unless `hostsNoEngine`). */
function namedDialectes(): string[] {
	return offeredEngines().map(function dialecteOf(spawner) {
		return spawner.dialecteId
	})
}

/** The engines named in every connection the realm opened, as the hub is offered them. */
function offeredEngines(): {
	dialecteId: string
	dialecteVersion: string
	engineUrl: string
	perf: boolean | undefined
}[] {
	return hub.opened.flatMap(function enginesOf({ spawners = [] }) {
		return spawners.map(function engineOf({ dialecteId, dialecteVersion, engineUrl, perf }) {
			return { dialecteId, dialecteVersion, engineUrl, perf }
		})
	})
}

/** The version a registered dialecte of the cases is offered at. */
function versionOf(params: { dialecteId: string }): string {
	return params.dialecteId === TEST_DIALECTE.id
		? TEST_DIALECTE.version
		: SECOND_FIXTURE_DIALECTE.version
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
		/** What the app registered (two dialectes of one worker unless the case says otherwise). */
		registered?: Registered
		storageRefused: boolean
		/** The connection the realm has already: bound by its page, joined on its own, or none. */
		kept?: 'bound' | 'own'
		/** Whether the project is measured (`dev.perf`). */
		perf?: boolean
		/** The version of the dialecte the project asks for (the registered one unless the case says otherwise). */
		dialecteVersion?: string
		call: 'connect' | 'destroy'
		expected: {
			answer: unknown
			/** The dialectes offered to the hub, in the order registered. */
			offered: string[]
			/** The offered engines whose stages are measured. */
			measured?: string[]
			connectionsOpened: number
			/**
			 * Whether the connector made through the hub was given the engine's address - a destroy then deletes the
			 * project's files in this realm - or none: the hub has a view that can store delete them.
			 */
			engineUrlGiven?: boolean
		}
	}
	const BOTH = [TEST_DIALECTE.id, SECOND_FIXTURE_DIALECTE.id]
	const testCases: Record<string, TestCase> = {
		'a realm that can store, connecting → through the hub, every registered dialecte offered, all on the one worker address':
			{
				storageRefused: false,
				call: 'connect',
				expected: { answer: 'through the hub', offered: BOTH, connectionsOpened: 1 },
			},
		'a realm that can store, connecting a measured project → every registered dialecte offered, only its own measured':
			{
				storageRefused: false,
				perf: true,
				call: 'connect',
				expected: {
					answer: 'through the hub',
					offered: BOTH,
					measured: [TEST_DIALECTE.id],
					connectionsOpened: 1,
				},
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
				offered: BOTH,
				connectionsOpened: 1,
				engineUrlGiven: true,
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
					engineUrlGiven: false,
				},
			},
		'a realm joined on its own whose private file system is refused, destroying → STORE_UNAVAILABLE, nothing asked of the hub':
			{
				storageRefused: true,
				kept: 'own',
				call: 'destroy',
				expected: { answer: 'STORE_UNAVAILABLE', offered: [], connectionsOpened: 0 },
			},
		'a child bound by its page, no engine registered in it, connecting → through the hub, nothing offered, no connection of its own':
			{
				registered: 'none',
				storageRefused: false,
				kept: 'bound',
				call: 'connect',
				expected: { answer: 'through the hub', offered: [], connectionsOpened: 0 },
			},
		'a child bound by its page, no engine registered in it, destroying → through the hub, its files deleted by a view that can store':
			{
				registered: 'none',
				storageRefused: false,
				kept: 'bound',
				call: 'destroy',
				expected: {
					answer: 'destroyed through the hub',
					offered: [],
					connectionsOpened: 0,
					engineUrlGiven: false,
				},
			},
		'a realm that can store, no engine registered, connecting → PROJECT_SQLITE_ENGINE_NOT_REGISTERED, nothing asked of the hub':
			{
				registered: 'none',
				storageRefused: false,
				call: 'connect',
				expected: {
					answer: 'PROJECT_SQLITE_ENGINE_NOT_REGISTERED',
					offered: [],
					connectionsOpened: 0,
				},
			},
		'a realm that can store, no engine registered, destroying → PROJECT_SQLITE_ENGINE_NOT_REGISTERED, nothing asked of the hub':
			{
				registered: 'none',
				storageRefused: false,
				call: 'destroy',
				expected: {
					answer: 'PROJECT_SQLITE_ENGINE_NOT_REGISTERED',
					offered: [],
					connectionsOpened: 0,
				},
			},
		'a realm that can store, an engine registered for another dialecte only, connecting → PROJECT_SQLITE_ENGINE_NOT_REGISTERED, nothing asked of the hub':
			{
				registered: 'another dialecte only',
				storageRefused: false,
				call: 'connect',
				expected: {
					answer: 'PROJECT_SQLITE_ENGINE_NOT_REGISTERED',
					offered: [],
					connectionsOpened: 0,
				},
			},
		'a realm joined on its own that can store, an engine registered, connecting → through the hub, every registered dialecte offered: a page connected first still offers them as the next project opens':
			{
				storageRefused: false,
				kept: 'own',
				call: 'connect',
				expected: { answer: 'through the hub', offered: BOTH, connectionsOpened: 1 },
			},
		'a child bound by its page, able to store, an engine registered for another dialecte only, connecting → through the hub, nothing offered, no connection of its own':
			{
				registered: 'another dialecte only',
				storageRefused: false,
				kept: 'bound',
				call: 'connect',
				expected: { answer: 'through the hub', offered: [], connectionsOpened: 0 },
			},
		'a child bound by its page, able to store, an engine registered for another dialecte only, destroying → through the hub, its files deleted by a view that can store':
			{
				registered: 'another dialecte only',
				storageRefused: false,
				kept: 'bound',
				call: 'destroy',
				expected: {
					answer: 'destroyed through the hub',
					offered: [],
					connectionsOpened: 0,
					engineUrlGiven: false,
				},
			},
		'a child bound by its page, able to store, an engine registered for its dialecte, destroying → through the hub, its files deleted here':
			{
				storageRefused: false,
				kept: 'bound',
				call: 'destroy',
				expected: {
					answer: 'destroyed through the hub',
					offered: BOTH,
					connectionsOpened: 1,
					engineUrlGiven: true,
				},
			},
		'a project of a registered dialecte at another version, connecting → through the hub, not refused as unregistered: a registration names a dialecte by id, the engine checks the version':
			{
				storageRefused: false,
				dialecteVersion: '9.9.9',
				call: 'connect',
				expected: { answer: 'through the hub', offered: BOTH, connectionsOpened: 1 },
			},
	}
	for (const [
		description,
		{ registered = 'two dialectes', storageRefused, kept, perf, dialecteVersion, call, expected },
	] of Object.entries(testCases)) {
		it(description, async () => {
			withRegistered({ registered })
			if (storageRefused) refuseRealmStorage()
			if (kept) hub.kept = Promise.resolve({ bound: kept === 'bound' })
			const answer = await answerOf({
				call: function connectOrDestroy() {
					const made = connector({ registered, perf, dialecteVersion })
					return call === 'connect' ? made.connect() : made.destroy()
				},
			})
			expect(answer).toBe(expected.answer)
			expect(namedDialectes()).toEqual(expected.offered)
			expect(
				offeredEngines().map(function addressOf({ engineUrl }) {
					return engineUrl
				}),
			).toEqual(expected.offered.map(() => TEST_ENGINE_URL))
			expect(
				offeredEngines().map(function versionOffered({ dialecteVersion: offeredVersion }) {
					return offeredVersion
				}),
			).toEqual(expected.offered.map((dialecteId) => versionOf({ dialecteId })))
			expect(
				offeredEngines()
					.filter(function measured({ perf: measures }) {
						return measures === true
					})
					.map(function dialecteOf({ dialecteId }) {
						return dialecteId
					}),
			).toEqual(expected.measured ?? [])
			expect(hub.opened).toHaveLength(expected.connectionsOpened)
			if (expected.engineUrlGiven !== undefined) {
				expect(
					hub.connectors.map(function addressGiven({ engineUrl }) {
						return engineUrl
					}),
				).toEqual([expected.engineUrlGiven ? TEST_ENGINE_URL : undefined])
			}
		})
	}

	it('a connector made before the engine was registered, asked after → the registration read at that moment: through the hub, every registered dialecte offered', async () => {
		withRegistered({ registered: 'two dialectes' })
		let registration: SqliteEngineRegistration | undefined
		const made = createSqliteConnector({
			name: `offer-${crypto.randomUUID()}`,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: TEST_DIALECTE.version,
			engine: function registeredLater() {
				return registration
			},
		})
		registration = registrationOf({ registered: 'two dialectes' })
		const answer = await answerOf({ call: () => made.connect() })
		expect(answer).toBe('through the hub')
		expect(namedDialectes()).toEqual(BOTH)
	})

	type ConnectHubCase = { registered: Registered; storageRefused: boolean; hostsNoEngine: boolean }
	const connectHubCases: Record<string, ConnectHubCase> = {
		'connectHub() in a page that can store → every registered dialecte offered, all on the one worker address':
			{ registered: 'two dialectes', storageRefused: false, hostsNoEngine: false },
		'connectHub() in a page whose private file system is refused → its engines checked, none offered (it hosts no engine)':
			{ registered: 'two dialectes', storageRefused: true, hostsNoEngine: true },
		'connectHub() before any engine was registered → the connection made and answered, nothing offered':
			{ registered: 'none', storageRefused: false, hostsNoEngine: false },
	}
	for (const [description, { registered, storageRefused, hostsNoEngine }] of Object.entries(
		connectHubCases,
	)) {
		it(description, async () => {
			withRegistered({ registered })
			if (storageRefused) refuseRealmStorage()
			const realm = await connectHub()
			expect(realm?.realmId()).toBe('realm')
			expect(namedDialectes()).toEqual(registered === 'none' ? [] : BOTH)
			expect(
				offeredEngines().map(function addressOf({ engineUrl }) {
					return engineUrl
				}),
			).toEqual(registered === 'none' ? [] : BOTH.map(() => TEST_ENGINE_URL))
			expect(
				hub.opened.map(function hostsNone(opened) {
					return opened.hostsNoEngine
				}),
			).toEqual([hostsNoEngine])
		})
	}
})
