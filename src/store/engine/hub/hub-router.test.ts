import { ENGINE_OPEN_BUDGET_MS } from '../client/client.constants'
import { createHubRouter } from './hub-router'
import {
	ENGINE_IDLE_CLOSE_MS,
	ENGINE_OPEN_MIN_BUDGET_MS,
	HUB_OPEN_BUDGET_MS,
	HUB_PROTOCOL_VERSION,
} from './hub.constants'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { HubCommand, HubEvent, HubOutput, HubRouter, HubSpawner } from './hub.types'
import type { BaseTestCase } from '@/test'

/** The id the engines of the cases say their project was created with. */
const CREATION_ID = 'creation-1'
const PROJECT = 'substation'
const SCL: HubSpawner = { dialecteId: 'scl', dialecteVersion: '1.0.0' }
const NSD: HubSpawner = { dialecteId: 'nsd', dialecteVersion: '1.0.0' }

function hello(params: {
	realmId: string
	topLevel?: boolean
	spawners?: HubSpawner[]
	parentRealmId?: string
	protocol?: number
	now?: number
}): HubEvent {
	const {
		realmId,
		topLevel = true,
		spawners = [SCL],
		parentRealmId,
		protocol = HUB_PROTOCOL_VERSION,
		now = 0,
	} = params
	return { type: 'hello', now, realmId, protocol, topLevel, spawners, parentRealmId }
}

function open(params: {
	realmId: string
	project?: string
	dialecteId?: string
	dialecteVersion?: string
	now?: number
	expectedCreationId?: string
}): HubEvent {
	const {
		realmId,
		project = PROJECT,
		dialecteId = SCL.dialecteId,
		dialecteVersion = SCL.dialecteVersion,
		now = 0,
		expectedCreationId,
	} = params
	return {
		type: 'open',
		now,
		realmId,
		project,
		dialecteId,
		dialecteVersion,
		...(expectedCreationId !== undefined && { expectedCreationId }),
	}
}

function engineOpened(params: {
	generation: number
	project?: string
	now?: number
	creationId?: string
}): HubEvent {
	const { generation, project = PROJECT, now = 0, creationId = CREATION_ID } = params
	return { type: 'engine-opened', now, project, dialecteId: 'scl', generation, creationId }
}

function realmGone(params: { realmId: string; now?: number }): HubEvent {
	const { realmId, now = 0 } = params
	return { type: 'realm-gone', now, realmId }
}

/**
 * What the runner checks over every case: an open waits (from an open or an `engine-lost`) for
 * exactly one answer; an engine is released at most once and only once spawned; and once every
 * deadline has come and every client has left, every engine spawned has been released.
 */
type Ledger = {
	/** Realm id -> the projects it waits for an answer on. */
	waiting: Map<string, Set<string>>
	/** Realm id -> the projects it holds an engine port for. */
	connected: Map<string, Set<string>>
	spawned: Set<string>
	released: Set<string>
	/** The router's last `wakeAt`. */
	wakeAt: number | undefined
	/** The latest time an event carried. */
	now: number
}

function markEntry(params: {
	entries: Map<string, Set<string>>
	realmId: string
	project: string
}): void {
	const { entries, realmId, project } = params
	const projects = entries.get(realmId) ?? new Set<string>()
	projects.add(project)
	entries.set(realmId, projects)
}

function unmarkEntry(params: {
	entries: Map<string, Set<string>>
	realmId: string
	project: string
}): boolean {
	const { entries, realmId, project } = params
	return entries.get(realmId)?.delete(project) ?? false
}

function listEntries(params: { entries: Map<string, Set<string>> }): string[] {
	return [...params.entries].flatMap(([realmId, projects]) =>
		[...projects].map((project) => `${realmId} / ${project}`),
	)
}

function engineKey(params: { project: string; generation: number }): string {
	return `${params.project} #${params.generation}`
}

function handleAndCheck(params: { router: HubRouter; ledger: Ledger; event: HubEvent }): HubOutput {
	const { router, ledger, event } = params
	ledger.now = Math.max(ledger.now, event.now)
	if (event.type === 'open') {
		markEntry({ entries: ledger.waiting, realmId: event.realmId, project: event.project })
	}
	if (event.type === 'leave') {
		unmarkEntry({ entries: ledger.waiting, realmId: event.realmId, project: event.project })
	}
	const output = router.handle(event)
	// a removed realm's commands come after its drop: check them against what it held before
	for (const command of output.commands) {
		if (command.type !== 'drop-realm') recordCommand({ ledger, command })
	}
	for (const command of output.commands) {
		if (command.type === 'drop-realm') recordCommand({ ledger, command })
	}
	if (event.type === 'leave') {
		unmarkEntry({ entries: ledger.connected, realmId: event.realmId, project: event.project })
	}
	ledger.wakeAt = output.wakeAt
	return output
}

function recordCommand(params: { ledger: Ledger; command: HubCommand }): void {
	const { ledger, command } = params
	if (command.type === 'engine-lost' || command.type === 'client-gone') {
		const held = unmarkEntry({
			entries: ledger.connected,
			realmId: command.realmId,
			project: command.project,
		})
		expect(held, `${command.type} for no port: ${command.realmId} / ${command.project}`).toBe(true)
	}
	if (command.type === 'engine-lost') {
		markEntry({ entries: ledger.waiting, realmId: command.realmId, project: command.project })
	}
	if (command.type === 'connect-client' || command.type === 'refuse-open') {
		const answered = unmarkEntry({
			entries: ledger.waiting,
			realmId: command.realmId,
			project: command.project,
		})
		expect(answered, `answered without a wait: ${command.realmId} / ${command.project}`).toBe(true)
	}
	if (command.type === 'connect-client') {
		markEntry({ entries: ledger.connected, realmId: command.realmId, project: command.project })
	}
	if (command.type === 'drop-realm') {
		ledger.waiting.delete(command.realmId)
		ledger.connected.delete(command.realmId)
	}
	if (command.type === 'spawn-engine') ledger.spawned.add(engineKey(command))
	if (command.type === 'release-engine') {
		expect(
			ledger.spawned.has(engineKey(command)),
			`released unspawned: ${engineKey(command)}`,
		).toBe(true)
		expect(ledger.released.has(engineKey(command)), `released twice: ${engineKey(command)}`).toBe(
			false,
		)
		ledger.released.add(engineKey(command))
	}
}

/** Let every deadline the router holds come, as the hub's timer would. */
function drainDeadlines(params: { router: HubRouter; ledger: Ledger }): void {
	const { router, ledger } = params
	for (let round = 0; ledger.wakeAt !== undefined && round < 20; round++) {
		const now = Math.max(ledger.wakeAt, ledger.now)
		handleAndCheck({ router, ledger, event: { type: 'tick', now } })
	}
	expect(ledger.wakeAt, 'deadlines that keep coming').toBeUndefined()
}

/** Every deadline passed, every client gone: nothing waits, every engine spawned was released. */
function settleAndCheck(params: { router: HubRouter; ledger: Ledger }): void {
	const { router, ledger } = params
	drainDeadlines({ router, ledger })
	expect(listEntries({ entries: ledger.waiting }), 'opens left without an answer').toEqual([])
	for (const [realmId, projects] of ledger.connected) {
		for (const project of projects) {
			handleAndCheck({
				router,
				ledger,
				event: { type: 'leave', now: ledger.now, realmId, project, dialecteId: 'scl' },
			})
		}
	}
	drainDeadlines({ router, ledger })
	expect([...ledger.released].toSorted(), 'engines never released').toEqual(
		[...ledger.spawned].toSorted(),
	)
}

function tick(params: { now: number }): HubEvent {
	return { type: 'tick', now: params.now }
}

function leave(params: { realmId: string; project?: string; now?: number }): HubEvent {
	const { realmId, project = PROJECT, now = 0 } = params
	return { type: 'leave', now, realmId, project, dialecteId: 'scl' }
}

function engineOpenFailed(params: {
	generation: number
	key: string | undefined
	error: unknown
	now?: number
}): HubEvent {
	const { generation, key, error, now = 0 } = params
	return {
		type: 'engine-open-failed',
		now,
		project: PROJECT,
		dialecteId: 'scl',
		generation,
		failure: { key, error },
	}
}

function engineEnded(params: { generation: number; now?: number }): HubEvent {
	const { generation, now = 0 } = params
	return { type: 'engine-ended', now, project: PROJECT, dialecteId: 'scl', generation }
}

function destroy(params: { realmId: string; now?: number; dialecteId?: string }): HubEvent {
	const { realmId, now = 0, dialecteId = 'scl' } = params
	return { type: 'destroy', now, realmId, project: PROJECT, dialecteId }
}

function destroyed(params: { realmId: string; now?: number }): HubEvent {
	const { realmId, now = 0 } = params
	return { type: 'destroyed', now, realmId, project: PROJECT, dialecteId: 'scl' }
}

/** The engine the shell is asked to spawn for the project, by generation. */
const SPAWN_SHELL_1: HubCommand = {
	type: 'spawn-engine',
	realmId: 'shell',
	project: PROJECT,
	dialecteId: 'scl',
	generation: 1,
	openBudgetMs: ENGINE_OPEN_BUDGET_MS,
}
const SPAWN_SHELL_2: HubCommand = { ...SPAWN_SHELL_1, generation: 2 }

/** An engine's error as the hub receives it: the router forwards it untouched. */
const BUSY_ERROR = { key: 'PROJECT_ENGINE_BUSY', detail: 'the engine lock is held' }
const DESTROYED_ERROR = { key: 'PROJECT_DESTROYED_WHILE_AWAY', detail: 'destroyed meanwhile' }
const QUOTA_ERROR = { key: 'STORE_QUOTA_EXCEEDED', detail: 'no room for a new project' }

describe('createHubRouter', () => {
	type TestStep = { event: HubEvent; commands: HubCommand[]; wakeAt?: number | undefined }
	type TestCase = BaseTestCase & {
		/** Replayed first, nothing asserted. */
		history: HubEvent[]
		/** Each step's commands asserted exactly, its `wakeAt` when the step names one. */
		steps: TestStep[]
	}

	const testCases: Record<string, TestCase> = {
		'a top-level realm opens a project first, another one connected before it → the opener hosts': {
			history: [hello({ realmId: 'other-tab' }), hello({ realmId: 'shell' })],
			steps: [
				{
					event: open({ realmId: 'shell' }),
					commands: [
						{
							type: 'spawn-engine',
							realmId: 'shell',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							openBudgetMs: ENGINE_OPEN_BUDGET_MS,
						},
					],
				},
			],
		},
		'a realm destroys the nsd project of a name while another realm uses the scl one → granted: two projects, the scl engine kept':
			{
				history: [
					hello({ realmId: 'shell', spawners: [SCL, NSD] }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'other-tab' }),
					engineOpened({ generation: 1 }),
				],
				steps: [
					{
						event: destroy({ realmId: 'shell', dialecteId: 'nsd' }),
						commands: [
							{ type: 'destroy-granted', realmId: 'shell', project: PROJECT, dialecteId: 'nsd' },
						],
					},
				],
			},
		'a realm coming back to the project it had opens it, no engine running → the engine started expects that project':
			{
				history: [hello({ realmId: 'shell' })],
				steps: [
					{
						event: open({ realmId: 'shell', expectedCreationId: CREATION_ID }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
				],
			},
		'the host dies while its engine opens, one client coming back to the project, one opening it anew → the next engine expects nothing: it may make the project':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					hello({ realmId: 'third-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab', expectedCreationId: CREATION_ID }),
					open({ realmId: 'third-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'the host dies while its engine opens, every client left coming back but to two creations → the next engine expects the first one’s: never a new project nobody asked for':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					hello({ realmId: 'third-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab', expectedCreationId: CREATION_ID }),
					open({ realmId: 'third-tab', expectedCreationId: 'another-creation' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
				],
			},
		'a client connected to the engine, then its host dies → the next engine expects the project the client has, though it opened it anew':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
				],
			},
		'the engine started for a realm coming back refuses with under a second of the window left → that realm refused as the engine said, the one that opened anew refused the window’s answer':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell', expectedCreationId: CREATION_ID }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'PROJECT_DESTROYED_WHILE_AWAY',
							error: DESTROYED_ERROR,
							now: HUB_OPEN_BUDGET_MS - 500,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: DESTROYED_ERROR },
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the engine started for a realm coming back refuses: its project destroyed meanwhile → that realm refused as the engine said; a realm that opened the project anew meanwhile gets an engine expecting nothing':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell', expectedCreationId: CREATION_ID }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'PROJECT_DESTROYED_WHILE_AWAY',
							error: DESTROYED_ERROR,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: DESTROYED_ERROR },
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'the host dies under clients that all come back to one project → the next engine expects it': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
				open({ realmId: 'other-tab', expectedCreationId: CREATION_ID }),
			],
			steps: [
				{
					event: realmGone({ realmId: 'shell', now: 1_000 }),
					commands: [
						{ type: 'drop-realm', realmId: 'shell' },
						{
							type: 'release-engine',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							hostRealmId: 'shell',
						},
						{
							type: 'engine-lost',
							realmId: 'other-tab',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
						},
						{
							type: 'spawn-engine',
							realmId: 'other-tab',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 2,
							openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							expectedCreationId: CREATION_ID,
						},
					],
				},
			],
		},
		'an iframe opens a project while a top-level realm can host → the top-level realm hosts': {
			history: [hello({ realmId: 'iframe', topLevel: false }), hello({ realmId: 'shell' })],
			steps: [
				{
					event: open({ realmId: 'iframe' }),
					commands: [
						{
							type: 'spawn-engine',
							realmId: 'shell',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							openBudgetMs: ENGINE_OPEN_BUDGET_MS,
						},
					],
				},
			],
		},
		'an iframe opens a project and the top-level realm runs only another dialecte → the iframe hosts':
			{
				history: [
					hello({ realmId: 'shell', spawners: [NSD] }),
					hello({ realmId: 'iframe', topLevel: false }),
				],
				steps: [
					{
						event: open({ realmId: 'iframe' }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'iframe',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'an engine is ready and a second realm opens the project → it gets a port to that engine': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
			],
			steps: [
				{
					event: engineOpened({ generation: 1 }),
					commands: [
						{
							type: 'connect-client',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							realmId: 'shell',
							creationId: CREATION_ID,
						},
					],
				},
				{
					event: open({ realmId: 'other-tab' }),
					commands: [
						{
							type: 'connect-client',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							realmId: 'other-tab',
							creationId: CREATION_ID,
						},
					],
				},
			],
		},
		'the host realm dies while another realm holds a port → engine lost, the other realm hosts and gets a port':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
					{
						event: engineOpened({ generation: 2, now: 1_100 }),
						commands: [
							{
								type: 'connect-client',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								realmId: 'other-tab',
								creationId: CREATION_ID,
							},
						],
					},
				],
			},
		'a realm holding a port dies while another realm hosts → the engine is told the client is gone':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'other-tab' }),
						commands: [
							{ type: 'drop-realm', realmId: 'other-tab' },
							{
								type: 'client-gone',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'other-tab',
							},
						],
					},
				],
			},
		'the last client leaves a ready engine → the engine is released once the grace has passed': {
			history: [
				hello({ realmId: 'shell' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [
				{
					event: leave({ realmId: 'shell', now: 1_000 }),
					commands: [
						{
							type: 'client-gone',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							realmId: 'shell',
						},
						{ type: 'left', realmId: 'shell', project: PROJECT, dialecteId: 'scl' },
					],
					wakeAt: 1_000 + ENGINE_IDLE_CLOSE_MS,
				},
				{
					event: tick({ now: 1_000 + ENGINE_IDLE_CLOSE_MS }),
					commands: [
						{
							type: 'release-engine',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							hostRealmId: 'shell',
						},
					],
					wakeAt: undefined,
				},
			],
		},
		'the last client leaves, a realm opens within the grace → it gets a port, the engine stays': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
				leave({ realmId: 'shell', now: 1_000 }),
			],
			steps: [
				{
					event: open({ realmId: 'other-tab', now: 2_000 }),
					commands: [
						{
							type: 'connect-client',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							realmId: 'other-tab',
							creationId: CREATION_ID,
						},
					],
					wakeAt: undefined,
				},
				{ event: tick({ now: 1_000 + ENGINE_IDLE_CLOSE_MS }), commands: [] },
			],
		},
		'a realm says hello, then a child bound to its port → both welcomed, only the parent lock watched':
			{
				history: [],
				steps: [
					{
						event: hello({ realmId: 'shell' }),
						commands: [
							{ type: 'welcome', realmId: 'shell' },
							{ type: 'watch-realm-lock', realmId: 'shell' },
						],
					},
					{
						event: hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
						commands: [{ type: 'welcome', realmId: 'widget' }],
					},
				],
			},
		'a child realm with a spawner opens a project its parent cannot host → refused, a child never hosts':
			{
				history: [
					hello({ realmId: 'shell', spawners: [NSD] }),
					hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
				],
				steps: [
					{
						event: open({ realmId: 'widget' }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'widget',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: 'no connected view can start an engine of "scl"',
									meta: { project: PROJECT, dialecteId: 'scl' },
								},
							},
						],
					},
				],
			},
		'a realm dies while a child and a grandchild bound to it hold ports → all three gone, the engine told of both clients':
			{
				history: [
					hello({ realmId: 'other-tab' }),
					hello({ realmId: 'shell', spawners: [] }),
					hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
					hello({ realmId: 'nested', topLevel: false, parentRealmId: 'widget' }),
					open({ realmId: 'other-tab' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'widget' }),
					open({ realmId: 'nested' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell' }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{ type: 'drop-realm', realmId: 'widget' },
							{ type: 'drop-realm', realmId: 'nested' },
							{
								type: 'client-gone',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'widget',
							},
							{
								type: 'client-gone',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'nested',
							},
						],
					},
				],
			},
		'the parent unbinds a child holding a port → the child is gone, the engine told the client is gone':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'widget' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'widget' }),
						commands: [
							{ type: 'drop-realm', realmId: 'widget' },
							{
								type: 'client-gone',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'widget',
							},
						],
					},
				],
			},
		'a realm opens a project no connected realm can start an engine for → refused, engine unavailable':
			{
				history: [hello({ realmId: 'shell', spawners: [NSD] })],
				steps: [
					{
						event: open({ realmId: 'shell' }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: 'no connected view can start an engine of "scl"',
									meta: { project: PROJECT, dialecteId: 'scl' },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'a realm says hello in another protocol version → refused': {
			history: [],
			steps: [
				{
					event: hello({ realmId: 'old-copy', protocol: HUB_PROTOCOL_VERSION + 1 }),
					commands: [
						{
							type: 'refuse-hello',
							realmId: 'old-copy',
							refusal: {
								origin: 'hub',
								key: 'STORE_PROTOCOL_MISMATCH',
								detail: `the hub speaks protocol ${HUB_PROTOCOL_VERSION}, the view ${HUB_PROTOCOL_VERSION + 1}`,
								meta: {
									hubProtocol: HUB_PROTOCOL_VERSION,
									realmProtocol: HUB_PROTOCOL_VERSION + 1,
								},
							},
						},
					],
				},
			],
		},
		'a realm runs another version of the dialecte than the engine and opens the project → refused, version mismatch':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'extension', topLevel: false, spawners: [] }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
				],
				steps: [
					{
						event: open({ realmId: 'extension', dialecteVersion: '1.1.0' }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'extension',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
									detail: `the engine of "${PROJECT}" runs scl 1.0.0, the view 1.1.0`,
									meta: {
										project: PROJECT,
										dialecteId: 'scl',
										engineVersion: '1.0.0',
										realmVersion: '1.1.0',
									},
								},
							},
						],
					},
				],
			},
		'a realm opens with another dialecte version than the only realm that can host → refused, no engine started':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'extension', topLevel: false, spawners: [] }),
				],
				steps: [
					{
						event: open({ realmId: 'extension', dialecteVersion: '1.1.0' }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'extension',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
									detail: `the engine of "${PROJECT}" runs scl 1.0.0, the view 1.1.0`,
									meta: {
										project: PROJECT,
										dialecteId: 'scl',
										engineVersion: '1.0.0',
										realmVersion: '1.1.0',
									},
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the host dies, the earlier of two top-level realms that can host runs another version than the clients → the later one hosts':
			{
				history: [
					hello({ realmId: 'old-tab' }),
					hello({
						realmId: 'new-tab',
						spawners: [{ dialecteId: 'scl', dialecteVersion: '1.1.0' }],
					}),
					hello({ realmId: 'other-old-tab' }),
					hello({ realmId: 'iframe', topLevel: false, spawners: [] }),
					open({ realmId: 'old-tab' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'iframe' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'old-tab' }),
						commands: [
							{ type: 'drop-realm', realmId: 'old-tab' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'old-tab',
							},
							{
								type: 'engine-lost',
								realmId: 'iframe',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'other-old-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
				],
			},
		'an open waits on an engine that never answers → one refusal when the open budget ends, a late answer changes nothing':
			{
				history: [hello({ realmId: 'shell' })],
				steps: [
					{
						event: open({ realmId: 'shell', now: 1_000 }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
					{
						event: tick({ now: HUB_OPEN_BUDGET_MS }),
						commands: [],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
					{
						event: tick({ now: 1_000 + HUB_OPEN_BUDGET_MS }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
					{ event: engineOpened({ generation: 1, now: 32_000 }), commands: [] },
				],
			},
		'the engine answers busy while time is left → retried on another host, then on the same one, then the busy answer goes to every waiting client':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					hello({ realmId: 'iframe', topLevel: false, spawners: [] }),
					open({ realmId: 'shell' }),
					open({ realmId: 'iframe' }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: 10_000,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
					{
						event: engineOpenFailed({
							generation: 2,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: 25_000,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								hostRealmId: 'other-tab',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 3,
								openBudgetMs: HUB_OPEN_BUDGET_MS - 25_000,
							},
						],
						wakeAt: HUB_OPEN_BUDGET_MS,
					},
					{
						event: engineOpenFailed({
							generation: 3,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: HUB_OPEN_BUDGET_MS - ENGINE_OPEN_MIN_BUDGET_MS + 1,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 3,
								hostRealmId: 'other-tab',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: BUSY_ERROR },
							},
							{
								type: 'refuse-open',
								realmId: 'iframe',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: BUSY_ERROR },
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the engine answers busy, the only other realm that can host runs another version → retried on the same host':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({
						realmId: 'new-tab',
						spawners: [{ dialecteId: 'scl', dialecteVersion: '1.1.0' }],
					}),
					open({ realmId: 'shell' }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: 10_000,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'the engine fails to open for another reason while two realms wait → both refused with the engine error, nothing retried':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'STORE_QUOTA_EXCEEDED',
							error: QUOTA_ERROR,
							now: 500,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: QUOTA_ERROR },
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: { origin: 'engine', error: QUOTA_ERROR },
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the host realm suspends (its lock let go), rejoins under a new id and opens again → it becomes a client of the realm elected after it':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
					{
						event: hello({ realmId: 'shell-resumed', now: 2_000 }),
						commands: [
							{ type: 'welcome', realmId: 'shell-resumed' },
							{ type: 'watch-realm-lock', realmId: 'shell-resumed' },
						],
					},
					{ event: open({ realmId: 'shell-resumed', now: 2_000 }), commands: [] },
					{
						event: engineOpened({ generation: 2, now: 2_100 }),
						commands: [
							{
								type: 'connect-client',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								realmId: 'other-tab',
								creationId: CREATION_ID,
							},
							{
								type: 'connect-client',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								realmId: 'shell-resumed',
								creationId: CREATION_ID,
							},
						],
					},
				],
			},
		'a realm says hello under the id of a connected realm → refused, the connected realm kept as it was':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'widget', topLevel: false, spawners: [], parentRealmId: 'shell' }),
				],
				steps: [
					{
						event: hello({ realmId: 'shell', spawners: [] }),
						commands: [
							{
								type: 'refuse-hello',
								realmId: 'shell',
								refusal: {
									origin: 'hub',
									key: 'STORE_REALM_ID_TAKEN',
									detail: 'a view "shell" is already connected',
									meta: { realmId: 'shell' },
								},
							},
						],
					},
					{
						event: open({ realmId: 'widget' }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'a realm opens a project of a name another dialecte holds → another project: an engine of its own, the first one kept':
			{
				history: [
					hello({ realmId: 'shell', spawners: [SCL, NSD] }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
				],
				steps: [
					{
						event: open({ realmId: 'shell', dialecteId: 'nsd' }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'nsd',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
					},
				],
			},
		'a realm the hub does not know opens a project → refused, realm unknown': {
			history: [hello({ realmId: 'shell' }), realmGone({ realmId: 'shell' })],
			steps: [
				{
					event: open({ realmId: 'shell' }),
					commands: [
						{
							type: 'refuse-open',
							realmId: 'shell',
							project: PROJECT,
							dialecteId: 'scl',
							refusal: {
								origin: 'hub',
								key: 'STORE_REALM_UNKNOWN',
								detail: 'the hub knows no view "shell"',
								meta: { realmId: 'shell' },
							},
						},
					],
				},
			],
		},
		'a child says hello after its parent is gone → refused, realm unknown': {
			history: [hello({ realmId: 'shell' }), realmGone({ realmId: 'shell' })],
			steps: [
				{
					event: hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
					commands: [
						{
							type: 'refuse-hello',
							realmId: 'widget',
							refusal: {
								origin: 'hub',
								key: 'STORE_REALM_UNKNOWN',
								detail: 'the hub knows no view "shell", the parent of "widget"',
								meta: { realmId: 'widget', parentRealmId: 'shell' },
							},
						},
					],
				},
			],
		},
		'the host realm dies and was the only client → engine released, no other engine started': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [
				{
					event: realmGone({ realmId: 'shell' }),
					commands: [
						{ type: 'drop-realm', realmId: 'shell' },
						{
							type: 'release-engine',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							hostRealmId: 'shell',
						},
					],
					wakeAt: undefined,
				},
			],
		},
		'the host realm dies, the engine elected after it never answers → the client refused when the new open budget ends':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
					{
						event: tick({ now: 1_000 + HUB_OPEN_BUDGET_MS }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								hostRealmId: 'other-tab',
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the host realm dies and no realm left can host → the clients told the engine is lost, then refused':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab', spawners: [] }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell' }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: 'no connected view can start an engine of "scl"',
									meta: { project: PROJECT, dialecteId: 'scl' },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the host serves only a child and unbinds it → the engine told the client is gone, released after the grace':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'widget', topLevel: false, parentRealmId: 'shell' }),
					open({ realmId: 'widget' }),
					engineOpened({ generation: 1 }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'widget', now: 1_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'widget' },
							{
								type: 'client-gone',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'widget',
							},
						],
						wakeAt: 1_000 + ENGINE_IDLE_CLOSE_MS,
					},
					{
						event: tick({ now: 1_000 + ENGINE_IDLE_CLOSE_MS }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the host dies while its engine is still opening → elected again in the same open window, no engine lost':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell', now: 1_000 }),
					open({ realmId: 'other-tab', now: 1_000 }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: 25_000 }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: 1_000 + HUB_OPEN_BUDGET_MS - 25_000,
							},
						],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
				],
			},
		'a waiting client dies while the engine opens → the engine is not told, the others still wait':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'other-tab' }),
						commands: [{ type: 'drop-realm', realmId: 'other-tab' }],
						wakeAt: HUB_OPEN_BUDGET_MS,
					},
					{
						event: engineOpened({ generation: 1 }),
						commands: [
							{
								type: 'connect-client',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								realmId: 'shell',
								creationId: CREATION_ID,
							},
						],
					},
				],
			},
		'the only waiting client leaves an opening engine, then opens again → a new open window, answered at its end':
			{
				history: [
					hello({ realmId: 'shell' }),
					open({ realmId: 'shell' }),
					leave({ realmId: 'shell', now: 1_000 }),
				],
				steps: [
					{
						event: open({ realmId: 'shell', now: 2_000 }),
						commands: [],
						wakeAt: 2_000 + HUB_OPEN_BUDGET_MS,
					},
					{
						event: tick({ now: 2_000 + HUB_OPEN_BUDGET_MS }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'a realm holding a port opens the project again → a fresh port, nothing else': {
			history: [
				hello({ realmId: 'shell' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [
				{
					event: open({ realmId: 'shell' }),
					commands: [
						{
							type: 'connect-client',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							realmId: 'shell',
							creationId: CREATION_ID,
						},
					],
					wakeAt: undefined,
				},
			],
		},
		'a ready engine ends while its host lives → its clients told the engine is lost, an engine started again':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: engineEnded({ generation: 1, now: 1_000 }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'engine-lost',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'engine-lost',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
				],
			},
		'an engine ends before it opened → its waiting clients refused, no engine started again': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
			],
			steps: [
				{
					event: engineEnded({ generation: 1, now: 300 }),
					commands: [
						{
							type: 'release-engine',
							project: PROJECT,
							dialecteId: 'scl',
							generation: 1,
							hostRealmId: 'shell',
						},
						{
							type: 'refuse-open',
							realmId: 'shell',
							project: PROJECT,
							dialecteId: 'scl',
							refusal: {
								origin: 'hub',
								key: 'PROJECT_ENGINE_UNAVAILABLE',
								detail: `the engine of "${PROJECT}" ended before it opened`,
								meta: { project: PROJECT, dialecteId: 'scl' },
							},
						},
					],
					wakeAt: undefined,
				},
			],
		},
		'the host of an opening engine dies once the open window has run out → the clients refused, no engine started again':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'shell', now: HUB_OPEN_BUDGET_MS }),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'the only client leaves an opening engine, then the engine answers busy → released, nothing started again':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					leave({ realmId: 'shell', now: 1_000 }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 1,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: 2_000,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'an engine opened after busy retries ends, the next engine answers busy → retried on a host not tried in the new window':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpenFailed({
						generation: 1,
						key: 'PROJECT_ENGINE_BUSY',
						error: BUSY_ERROR,
						now: 10_000,
					}),
					engineOpenFailed({
						generation: 2,
						key: 'PROJECT_ENGINE_BUSY',
						error: BUSY_ERROR,
						now: 20_000,
					}),
					engineOpened({ generation: 3, now: 21_000 }),
					engineEnded({ generation: 3, now: 50_000 }),
				],
				steps: [
					{
						event: engineOpenFailed({
							generation: 4,
							key: 'PROJECT_ENGINE_BUSY',
							error: BUSY_ERROR,
							now: 60_000,
						}),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 4,
								hostRealmId: 'shell',
							},
							{
								type: 'spawn-engine',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 5,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
								expectedCreationId: CREATION_ID,
							},
						],
					},
				],
			},
		'the engine is in its grace with no client, a realm on another version opens → that engine released, one of the realm version started':
			{
				history: [
					hello({ realmId: 'old-tab' }),
					hello({
						realmId: 'new-tab',
						spawners: [{ dialecteId: 'scl', dialecteVersion: '1.1.0' }],
					}),
					open({ realmId: 'old-tab' }),
					engineOpened({ generation: 1 }),
					leave({ realmId: 'old-tab', now: 1_000 }),
				],
				steps: [
					{
						event: open({ realmId: 'new-tab', dialecteVersion: '1.1.0', now: 2_000 }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'old-tab',
							},
							{
								type: 'spawn-engine',
								realmId: 'new-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
						wakeAt: 2_000 + HUB_OPEN_BUDGET_MS,
					},
				],
			},
		'a realm that is no client leaves the project → nothing': {
			history: [
				hello({ realmId: 'shell' }),
				hello({ realmId: 'other-tab' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [
				{
					event: leave({ realmId: 'other-tab' }),
					commands: [{ type: 'left', realmId: 'other-tab', project: PROJECT, dialecteId: 'scl' }],
					wakeAt: undefined,
				},
				{
					event: leave({ realmId: 'other-tab', project: 'unopened' }),
					commands: [
						{ type: 'left', realmId: 'other-tab', project: 'unopened', dialecteId: 'scl' },
					],
					wakeAt: undefined,
				},
			],
		},
		'the lock of a realm the hub does not know is granted → nothing': {
			history: [hello({ realmId: 'shell' })],
			steps: [{ event: realmGone({ realmId: 'unknown' }), commands: [], wakeAt: undefined }],
		},
		'the timer fires with no deadline held → nothing': {
			history: [
				hello({ realmId: 'shell' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [{ event: tick({ now: 60_000 }), commands: [], wakeAt: undefined }],
		},
		'an engine opening for no one, a realm on another version that can host opens → that engine released, one of the realm version started':
			{
				history: [
					hello({ realmId: 'old-tab' }),
					hello({
						realmId: 'new-tab',
						spawners: [{ dialecteId: 'scl', dialecteVersion: '1.1.0' }],
					}),
					open({ realmId: 'old-tab' }),
					leave({ realmId: 'old-tab', now: 1_000 }),
				],
				steps: [
					{
						event: open({ realmId: 'new-tab', dialecteVersion: '1.1.0', now: 2_000 }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'old-tab',
							},
							{
								type: 'spawn-engine',
								realmId: 'new-tab',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
						wakeAt: 2_000 + HUB_OPEN_BUDGET_MS,
					},
				],
			},
		'the engine is in its grace with no client, a realm on another version no realm can host opens → refused, the engine kept':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'extension', topLevel: false, spawners: [] }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					leave({ realmId: 'shell', now: 1_000 }),
				],
				steps: [
					{
						event: open({ realmId: 'extension', dialecteVersion: '1.1.0', now: 2_000 }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'extension',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
									detail: `the engine of "${PROJECT}" runs scl 1.0.0, the view 1.1.0`,
									meta: {
										project: PROJECT,
										dialecteId: 'scl',
										engineVersion: '1.0.0',
										realmVersion: '1.1.0',
									},
								},
							},
						],
						wakeAt: 1_000 + ENGINE_IDLE_CLOSE_MS,
					},
				],
			},
		'the engine is in its grace with no client, a realm opens a project of its name under another dialecte → an engine of its own, the first one kept in its grace':
			{
				history: [
					hello({ realmId: 'shell', spawners: [SCL, NSD] }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					leave({ realmId: 'shell', now: 1_000 }),
				],
				steps: [
					{
						event: open({ realmId: 'shell', dialecteId: 'nsd', now: 2_000 }),
						commands: [
							{
								type: 'spawn-engine',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'nsd',
								generation: 2,
								openBudgetMs: ENGINE_OPEN_BUDGET_MS,
							},
						],
						wakeAt: 1_000 + ENGINE_IDLE_CLOSE_MS,
					},
				],
			},
		'an engine already open says it opened again → nothing, no second port': {
			history: [
				hello({ realmId: 'shell' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [{ event: engineOpened({ generation: 1 }), commands: [] }],
		},
		'an engine already open says it failed to open → nothing, its clients keep their ports': {
			history: [
				hello({ realmId: 'shell' }),
				open({ realmId: 'shell' }),
				engineOpened({ generation: 1 }),
			],
			steps: [
				{
					event: engineOpenFailed({
						generation: 1,
						key: 'STORE_QUOTA_EXCEEDED',
						error: QUOTA_ERROR,
					}),
					commands: [],
				},
			],
		},
		'the host of an opening engine dies with less than the minimum open budget left → the clients refused, no engine started again':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: realmGone({
							realmId: 'shell',
							now: HUB_OPEN_BUDGET_MS - ENGINE_OPEN_MIN_BUDGET_MS + 1,
						}),
						commands: [
							{ type: 'drop-realm', realmId: 'shell' },
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `no engine for "${PROJECT}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, dialecteId: 'scl', openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
				],
			},
		'a realm destroys the project while another realm is its client → refused PROJECT_OPEN_ELSEWHERE, nothing changes':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					open({ realmId: 'other-tab' }),
					leave({ realmId: 'shell' }),
				],
				steps: [
					{
						event: destroy({ realmId: 'shell' }),
						commands: [
							{
								type: 'refuse-destroy',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_OPEN_ELSEWHERE',
									detail: `"${PROJECT}" is open in 1 other view(s)`,
									meta: { project: PROJECT, connections: 1 },
								},
							},
						],
					},
				],
			},
		'a realm destroys the project its engine idles in → engine released, destroy granted; an open meanwhile waits until destroyed, then is elected':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
					leave({ realmId: 'shell' }),
				],
				steps: [
					{
						event: destroy({ realmId: 'shell' }),
						commands: [
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{ type: 'destroy-granted', realmId: 'shell', project: PROJECT, dialecteId: 'scl' },
						],
						wakeAt: undefined,
					},
					{ event: open({ realmId: 'other-tab' }), commands: [] },
					{
						event: destroyed({ realmId: 'shell' }),
						// the opener, a client of the project, hosts
						commands: [{ ...SPAWN_SHELL_2, realmId: 'other-tab' }],
					},
				],
			},
		'a realm destroys the project while still its client (another connection of the realm) → told its engine is gone, held, given a new engine once destroyed':
			{
				history: [
					hello({ realmId: 'shell' }),
					open({ realmId: 'shell' }),
					engineOpened({ generation: 1 }),
				],
				steps: [
					{
						event: destroy({ realmId: 'shell' }),
						commands: [
							{
								type: 'engine-lost',
								realmId: 'shell',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
							},
							{
								type: 'release-engine',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 1,
								hostRealmId: 'shell',
							},
							{ type: 'destroy-granted', realmId: 'shell', project: PROJECT, dialecteId: 'scl' },
						],
					},
					{ event: destroyed({ realmId: 'shell' }), commands: [SPAWN_SHELL_2] },
					{
						event: engineOpened({ generation: 2 }),
						commands: [
							{
								type: 'connect-client',
								project: PROJECT,
								dialecteId: 'scl',
								generation: 2,
								realmId: 'shell',
								creationId: CREATION_ID,
							},
						],
					},
				],
			},
		'a realm destroys a project no engine runs → granted at once; a second destroy meanwhile refused':
			{
				history: [hello({ realmId: 'shell' }), hello({ realmId: 'other-tab' })],
				steps: [
					{
						event: destroy({ realmId: 'shell' }),
						commands: [
							{ type: 'destroy-granted', realmId: 'shell', project: PROJECT, dialecteId: 'scl' },
						],
					},
					{
						event: destroy({ realmId: 'other-tab' }),
						commands: [
							{
								type: 'refuse-destroy',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_OPEN_ELSEWHERE',
									detail: `"${PROJECT}" is being destroyed by another view`,
									meta: { project: PROJECT },
								},
							},
						],
					},
					{ event: destroyed({ realmId: 'other-tab' }), commands: [] },
					{ event: destroyed({ realmId: 'shell' }), commands: [] },
				],
			},
		'the destroying realm dies before it is done → the hold lifted: the open made meanwhile is elected':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					destroy({ realmId: 'other-tab' }),
					open({ realmId: 'shell' }),
				],
				steps: [
					{
						event: realmGone({ realmId: 'other-tab' }),
						commands: [{ type: 'drop-realm', realmId: 'other-tab' }, SPAWN_SHELL_1],
					},
				],
			},
		'a destroy never said done → the open made meanwhile refused PROJECT_ENGINE_UNAVAILABLE once the open budget has passed; the project still held':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					destroy({ realmId: 'shell' }),
				],
				steps: [
					{
						event: open({ realmId: 'other-tab', now: 1_000 }),
						commands: [],
						wakeAt: 1_000 + HUB_OPEN_BUDGET_MS,
					},
					{
						event: tick({ now: 1_000 + HUB_OPEN_BUDGET_MS }),
						commands: [
							{
								type: 'refuse-open',
								realmId: 'other-tab',
								project: PROJECT,
								dialecteId: 'scl',
								refusal: {
									origin: 'hub',
									key: 'PROJECT_ENGINE_UNAVAILABLE',
									detail: `"${PROJECT}" is being destroyed and was not done within ${HUB_OPEN_BUDGET_MS} ms`,
									meta: { project: PROJECT, openBudgetMs: HUB_OPEN_BUDGET_MS },
								},
							},
						],
						wakeAt: undefined,
					},
					{ event: open({ realmId: 'other-tab', now: 2_000 + HUB_OPEN_BUDGET_MS }), commands: [] },
					{
						event: destroyed({ realmId: 'shell', now: 3_000 + HUB_OPEN_BUDGET_MS }),
						commands: [{ ...SPAWN_SHELL_1, realmId: 'other-tab' }],
					},
				],
			},
		'a realm leaves a project held by a destroy → its open dropped: nothing elected once destroyed':
			{
				history: [
					hello({ realmId: 'shell' }),
					hello({ realmId: 'other-tab' }),
					destroy({ realmId: 'shell' }),
					open({ realmId: 'other-tab' }),
				],
				steps: [
					{
						event: leave({ realmId: 'other-tab' }),
						commands: [{ type: 'left', realmId: 'other-tab', project: PROJECT, dialecteId: 'scl' }],
						wakeAt: undefined,
					},
					{ event: destroyed({ realmId: 'shell' }), commands: [] },
				],
			},
		'a realm unknown to the hub destroys a project → refused STORE_REALM_UNKNOWN': {
			history: [],
			steps: [
				{
					event: destroy({ realmId: 'ghost' }),
					commands: [
						{
							type: 'refuse-destroy',
							realmId: 'ghost',
							project: PROJECT,
							dialecteId: 'scl',
							refusal: {
								origin: 'hub',
								key: 'STORE_REALM_UNKNOWN',
								detail: 'the hub knows no view "ghost"',
								meta: { realmId: 'ghost' },
							},
						},
					],
				},
			],
		},
	}

	runTestCases.generic(testCases, function replayAndAssert(testCase) {
		const router = createHubRouter()
		const ledger: Ledger = {
			waiting: new Map(),
			connected: new Map(),
			spawned: new Set(),
			released: new Set(),
			wakeAt: undefined,
			now: 0,
		}
		for (const event of testCase.history) handleAndCheck({ router, ledger, event })
		for (const step of testCase.steps) {
			const output = handleAndCheck({ router, ledger, event: step.event })
			expect(output.commands).toEqual(step.commands)
			if ('wakeAt' in step) expect(output.wakeAt).toBe(step.wakeAt)
		}
		settleAndCheck({ router, ledger })
	})
})
