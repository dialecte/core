import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { refuseRealmStorage } from '../../sqlite/adapter/realm-storage.fixtures'
import { createSqliteConnector } from '../../sqlite/adapter/sqlite-connector'
import { sqliteHubSpawner } from '../../sqlite/adapter/sqlite-hub-spawner'
import { TEST_ENGINE_URL } from '../../sqlite/runtime/runtime.fixtures'
import { createHubConnector } from '../client/hub-connector'
import { EngineStore } from '../engine-store'
import { adoptHubConnection, openHubConnection } from './hub-client'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { StoreNotice } from '../../store.types'
import type { HubConnection } from './hub-client.types'
import type { BootRealmParams, BrowserRealm, HubPortMessage } from './hub.browser.fixtures.types'

/**
 * A realm of the cross-realm cases, booted in an iframe of the test page: joined to the origin's hub on
 * its own (its lock, its lifecycle) or through a port its parent hands it, its stores reaching their
 * engines through that hub.
 */
export async function bootRealm(params: BootRealmParams): Promise<BrowserRealm> {
	const {
		canStartEngines,
		engineUrl = TEST_ENGINE_URL,
		dialecteVersion = TEST_DIALECTE.version,
		bound = false,
		storageRefused = false,
	} = params
	if (storageRefused) refuseRealmStorage()
	const joined = bound
		? await adoptHubConnection({ port: await handedPorts() })
		: await openHubConnection({
				spawners: canStartEngines
					? [
							sqliteHubSpawner({
								dialecteId: TEST_DIALECTE.id,
								dialecteVersion: TEST_DIALECTE.version,
								engineUrl,
							}),
						]
					: [],
			})
	if (!joined) throw new Error('the realm found no hub')
	const connection: HubConnection = joined
	const stores = new Map<string, Promise<EngineStore>>()
	/** What each project's store told since the case listened to it. */
	const heard = new Map<string, string[]>()

	function storeOf(params: { project: string }): Promise<EngineStore> {
		const { project } = params
		const kept = stores.get(project)
		if (kept) return kept
		const opening = openStore({ connection, project, engineUrl, dialecteVersion })
		stores.set(project, opening)
		return opening
	}

	return {
		realmId: function currentRealmId() {
			return connection.realmId()
		},
		registerDocument: async function registerThrough({ project, id }) {
			const store = await storeOf({ project })
			await store.registerDocument(makeDocument({ id }))
		},
		documentIds: async function documentIdsThrough({ project }) {
			const store = await storeOf({ project })
			const documents = await store.getDocuments()
			return documents.map(function idOf(document) {
				return document.id
			})
		},
		importHeld: async function importThrough({ project, writeId, file }) {
			const store = await storeOf({ project })
			const { record } = await store.importFile({ file, writeId })
			return { documentId: record.id }
		},
		writeOutcome: async function writeOutcomeThrough({ project, writeId }) {
			const store = await storeOf({ project })
			return store.getWriteOutcome({ writeId })
		},
		commitRecord: async function commitThrough({ project, documentId, id }) {
			const store = await storeOf({ project })
			await store.commit({
				documentId,
				creates: [makeRecord({ id })],
				updates: [],
				deletes: [],
				onProgress: ignoreProgress,
			})
		},
		recordIds: async function recordIdsThrough({ project, documentId }) {
			const store = await storeOf({ project })
			const records = await store.getByDocumentId(documentId)
			return records.map(function idOf(record) {
				return record.id
			})
		},
		exportUnder: async function exportThroughEngine({
			project,
			documentId,
			exportId,
			onFirstProgress,
		}) {
			const link = await createHubConnector({
				name: project,
				connection,
				dialecteId: TEST_DIALECTE.id,
				dialecteVersion,
				engineUrl,
			}).connect()
			let told = false
			try {
				const engine = await link.engine()
				const { file } = await engine.exportFile(
					{ documentId, options: { batchSize: 1 }, exportId },
					function tellFirstProgress() {
						if (told) return
						told = true
						onFirstProgress?.()
					},
				)
				return file.size
			} catch (thrown) {
				return toDialecteError(thrown)?.key ?? String(thrown)
			} finally {
				link.close()
			}
		},
		createHubPort: function createChildPort() {
			return connection.createHubPort()
		},
		lifecycle: function dispatchLifecycle({ type, persisted = false }) {
			if (type === 'freeze' || type === 'resume') document.dispatchEvent(new Event(type))
			else window.dispatchEvent(new PageTransitionEvent(type, { persisted }))
		},
		rebindOnRejoin: function rebindChild({ child }) {
			connection.onRejoined(function bindChildAgain() {
				const handle = connection.createHubPort()
				const message: HubPortMessage = { type: 'hub-port', port: handle.port }
				child.postMessage(message, '*', [handle.port])
			})
		},
		listen: async function listenTo({ project }) {
			const store = await storeOf({ project })
			const told: string[] = []
			heard.set(project, told)
			store.subscribe(function keep(notice) {
				told.push(describeNotice({ notice }))
			})
		},
		heard: function heardOf({ project }) {
			return [...(heard.get(project) ?? [])]
		},
		closeStore: function closeStoreOf({ project }) {
			void stores.get(project)?.then(function closeIt(store) {
				store.close()
			})
			stores.delete(project)
		},
		destroyProject: async function destroyThrough({ project }) {
			const store = await storeOf({ project })
			stores.delete(project)
			await store.destroy()
		},
		registerThroughSqlite: async function registerThroughSqlite({ project, id }) {
			const store = sqliteStoreOf({ project, engineUrl, dialecteVersion })
			try {
				await store.open()
				await store.registerDocument(makeDocument({ id }))
				const documents = await store.getDocuments()
				return documents.map(function idOf(document) {
					return document.id
				})
			} catch (thrown) {
				return toDialecteError(thrown)?.key ?? String(thrown)
			} finally {
				store.close()
			}
		},
		destroyThroughSqlite: async function destroyThroughSqlite({ project }) {
			const store = sqliteStoreOf({ project, engineUrl, dialecteVersion })
			return store.destroy().then(
				function destroyed() {
					return 'destroyed'
				},
				function refused(thrown: unknown) {
					return toDialecteError(thrown)?.key ?? String(thrown)
				},
			)
		},
	}
}

/** The project's store on the SQLite connector, as a project on `sqlite` storage makes it (not opened). */
function sqliteStoreOf(params: {
	project: string
	engineUrl: string
	dialecteVersion: string
}): EngineStore {
	const { project, engineUrl, dialecteVersion } = params
	return new EngineStore({
		name: project,
		connector: createSqliteConnector({
			name: project,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion,
			engineUrl,
		}),
	})
}

/** The project's store through the realm's hub connection, opened. */
async function openStore(params: {
	connection: HubConnection
	project: string
	engineUrl: string
	dialecteVersion: string
}): Promise<EngineStore> {
	const { connection, project, engineUrl, dialecteVersion } = params
	const store = new EngineStore({
		name: project,
		connector: createHubConnector({
			name: project,
			connection,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion,
			engineUrl,
		}),
	})
	await store.open()
	return store
}

/**
 * The first hub port this realm's parent posts it; every later one handed to `adoptHubConnection` too,
 * as a child does when its page binds it again.
 */
function handedPorts(): Promise<MessagePort> {
	let first = true
	return new Promise(function waitForPort(resolve) {
		window.addEventListener('message', function takePort(event: MessageEvent<HubPortMessage>) {
			if (event.data?.type !== 'hub-port') return
			if (first) {
				first = false
				resolve(event.data.port)
				return
			}
			adoptHubConnection({ port: event.data.port }).catch(function boundAgainNoMore(
				thrown: unknown,
			) {
				console.error('the realm could not be bound again:', thrown)
			})
		})
	})
}

function ignoreProgress(): void {}

/** A notice as a case reads it: `resync`, or `<type> <document> own|other`. */
function describeNotice(params: { notice: StoreNotice }): string {
	const { notice } = params
	if (notice.type === 'resync') return 'resync'
	const documentId = 'documentId' in notice.message ? notice.message.documentId : '-'
	return `${notice.message.type} ${documentId} ${notice.own ? 'own' : 'other'}`
}
