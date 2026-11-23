import { Project } from './project'
import { SWITCH_CONFIG, SWITCH_DIALECTE_ID, SWITCH_STORAGES } from './store-switch.fixtures'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { InMemoryStore } from '@/store/in-memory'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { ProjectChannelMessage, StorageParam } from './types'
import type { Store, StoreVersion } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

// The store is a switch: a commit, an undo and a redo each tell the version their write produced, on every storage; a
// store that keeps no version, or a commit whose answer was lost with its connection, tells none.

type StorageOf = (typeof SWITCH_STORAGES)[string]

const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const SOURCE_XML = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root">
		<B ${customId}="b" aB="first" />
	</Root>
`

const opened: Project<AnyDialecteConfig>[] = []
const listeners: BroadcastChannel[] = []

afterEach(async () => {
	for (const channel of listeners.splice(0)) channel.close()
	const projects = opened.splice(0)
	for (const project of projects) await project.close()
	for (const project of projects) await project.destroy()
})

async function openProject(params: {
	storage: StorageParam
	name: string
}): Promise<Project<AnyDialecteConfig>> {
	const { storage, name } = params
	const project = await new Project({
		configs: { default: SWITCH_CONFIG },
		storage,
		dialecteId: SWITCH_DIALECTE_ID,
	}).open(name)
	opened.push(project)
	return project
}

/** The project with the source imported, its records keeping their ids. */
async function importedOn(params: {
	storage: StorageParam
	name: string
}): Promise<{ project: Project<AnyDialecteConfig>; documentId: string }> {
	const project = await openProject(params)
	const file = new File([SOURCE_XML], 'source.xml', { type: 'text/xml' })
	const { documentId } = await project.importFile(file, { useCustomRecordsIds: true })
	return { project, documentId }
}

/** The version of every commit message the project's listeners hear, in order (`undefined` when it tells none). */
function versionsHeard(params: {
	project: Project<AnyDialecteConfig>
}): (StoreVersion | undefined)[] {
	const heard: (StoreVersion | undefined)[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function keep(event: MessageEvent<ProjectChannelMessage>) {
		if (event.data.type === 'commit') heard.push(event.data.version)
	}
	listeners.push(channel)
	return heard
}

/** The store a project writes through. */
function storeOf(params: { project: Project<AnyDialecteConfig> }): Store {
	return (params.project as unknown as { store: Store }).store
}

function updateB(params: {
	project: Project<AnyDialecteConfig>
	documentId: string
	value: string
}): Promise<void> {
	const { project, documentId, value } = params
	return project.openDocument(documentId).transaction(async function writeB(tx) {
		await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: value } })
	})
}

/**
 * An in-memory store that announces nothing (the project posts its own messages), with `commit` and `readVersion` as
 * `overrides` has them (`undefined`: the store has none).
 */
function customStoreOf(params: {
	name: string
	overrides: Partial<Record<'commit' | 'readVersion', unknown>>
}): Store {
	const { name, overrides } = params
	const store = new InMemoryStore(name, {
		dialecteId: SWITCH_DIALECTE_ID,
		runtime: { configs: { default: SWITCH_CONFIG }, defaultConfigKey: 'default' },
	})
	return new Proxy(store, {
		get: function readMember(target, property, receiver) {
			if (property === 'subscribe') return undefined
			if (typeof property === 'string' && property in overrides) {
				return overrides[property as keyof typeof overrides]
			}
			return Reflect.get(target, property, receiver)
		},
	})
}

describe('the version a write produced, told with its message', () => {
	for (const [storageName, storageOf] of Object.entries(SWITCH_STORAGES) as [string, StorageOf][]) {
		describe(storageName, () => {
			it('a commit, its undo, its redo → each message carries the version, the last the store’s version now', async () => {
				const name = `store-version-${crypto.randomUUID()}`
				const storage = await storageOf({ name, dialecteId: SWITCH_DIALECTE_ID })
				const { project, documentId } = await importedOn({ storage, name })
				const store = storeOf({ project })
				expect(store.readVersion, 'the store reads a version').toBeTypeOf('function')
				const before = await store.readVersion!({ documentId })
				const heard = versionsHeard({ project })

				await updateB({ project, documentId, value: 'second' })
				await project.undo(documentId)
				await project.redo(documentId)

				const now = await store.readVersion!({ documentId })
				await vi.waitFor(function everyStepHeard() {
					expect({ heard, now }).toEqual({
						heard: [1, 2, 3].map((step) => ({
							engineId: before.engineId,
							count: before.count + step,
						})),
						now: { engineId: before.engineId, count: before.count + 3 },
					})
				})
			})
		})
	}

	it('a store that keeps no version → its commit told with none, as before', async () => {
		const name = `store-version-${crypto.randomUUID()}`
		const store = customStoreOf({
			name,
			overrides: {
				readVersion: undefined,
				commit: async function commitAnsweringNothing(
					this: Store,
					commitParams: Parameters<Store['commit']>[0],
				) {
					await InMemoryStore.prototype.commit.call(this, commitParams)
				},
			},
		})
		const { project, documentId } = await importedOn({ storage: { type: 'custom', store }, name })
		const heard = versionsHeard({ project })

		await updateB({ project, documentId, value: 'second' })

		await vi.waitFor(function commitHeard() {
			expect(heard).toEqual([undefined])
		})
	})

	it('a commit lost with its connection, then found applied → told with no version', async () => {
		const name = `store-version-${crypto.randomUUID()}`
		const store = customStoreOf({
			name,
			overrides: {
				commit: async function commitThenLoseTheAnswer(
					this: Store,
					commitParams: Parameters<Store['commit']>[0],
				) {
					await InMemoryStore.prototype.commit.call(this, commitParams)
					throw createDialecteError('STORE_CONNECTION_LOST', {
						detail: 'the answer was lost on its way back',
					})
				},
			},
		})
		const { project, documentId } = await importedOn({ storage: { type: 'custom', store }, name })
		const heard = versionsHeard({ project })
		const told: ProjectChannelMessage[] = []
		const channel = project.createChannel()
		channel.onmessage = function keep(event: MessageEvent<ProjectChannelMessage>) {
			told.push(event.data)
		}
		listeners.push(channel)

		await updateB({ project, documentId, value: 'second' })

		await vi.waitFor(function commitHeard() {
			expect(told.map((message) => message.type)).toEqual(['commit'])
		})
		expect(heard).toEqual([undefined])
	})
})
