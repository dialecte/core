import { resolveStore } from '../store/resolve-store'
import { Project } from './project'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { withSqliteStorage } from '@/store/sqlite-storage.fixtures'
import { CHANGE_TOLD_WITHIN_MS } from '@/store/sqlite/runtime/runtime.fixtures.constants'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'
import { testStoreFor } from '@/test/test-storage'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'
import { selectFirstNode, withXmlDocument } from '@/test/xml'

import type { ProjectChannelMessage, StorageParam } from './types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// The store is a switch: what a project does through its public API is the same whichever store it
// runs on. Every case runs on every storage; a case red on one storage only is a store bug, or a difference
// stated with its reason.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

/** The dialecte the cases' projects are of, unless a case names another. */
const DIALECTE_ID = 'core/test'

/** How a project of a case gets its storage: by its name and dialecte, the engine's hooks given (SQLite runs its own). */
type StorageOf = (params: {
	name: string
	dialecteId: string
	hooks?: DialecteHooks<AnyDialecteConfig>
}) => Promise<StorageParam>

const STORAGES: Record<string, StorageOf> = {
	'in memory': async function inMemory() {
		return { type: 'inMemory' }
	},
	'on IndexedDB': async function local() {
		return { type: 'local' }
	},
	'on SQLite (the engine in this realm)': function sqliteInProcess({ name, dialecteId, hooks }) {
		withSqliteStorage()
		return testStoreFor({
			storage: { type: 'sqlite' },
			name,
			dialecte: {
				id: dialecteId,
				configs: { default: CONFIG },
				defaultConfigKey: 'default',
				createHooks: function engineHooks() {
					return hooks ?? {}
				},
			},
		})
	},
}

/** Why IndexedDB answers otherwise: its projects share the name's channel and database, and it tells no change itself. */
const INDEXEDDB_ANNOUNCES_NOTHING =
	'IndexedDB announces nothing itself: each project posts its own calls on the name’s channel, a no-op included, and a write made by a store alone is told to no one (until the local store moves to SQLite)'
const INDEXEDDB_KEYED_BY_NAME =
	'an IndexedDB database is named by the project name alone: two dialectes’ projects of a name are one database, one channel (until the local store moves to SQLite)'

const HOOK_TEXT = 'written by the hook'

function leafFile(): File {
	const xml = /* xml */ `
		<Root ${XMLNS_DEFAULT_NAMESPACE}>
			<C aC="c">
				<CC_1 aCC_1="fixed_val">
					<CCC_1 aCCC_1="ccc">
						<CCCC_1 aCCCC_1="leaf">as imported</CCCC_1>
					</CCC_1>
				</CC_1>
			</C>
		</Root>
	`
	return new File([xml], 'leaf.xml', { type: 'text/xml' })
}

/** Import hooks whose session rewrites the text of every `CCCC_1` once the file is stored. */
const TEXT_WRITING_HOOKS: DialecteHooks<AnyDialecteConfig> = {
	createImportSession: () => {
		const leafIds: string[] = []
		return {
			recordTagNames: ['CCCC_1'],
			beforeImportRecord: ({ record }) => {
				leafIds.push(record.id)
			},
			afterImport: async () => ({
				updates: leafIds.map((recordId) => ({ recordId, value: HOOK_TEXT })),
			}),
		}
	},
}

const opened: Project<AnyDialecteConfig>[] = []

/** A project open on `storage`, under `name` when given (a new name otherwise), of `dialecteId` when given. */
async function openProject(params: {
	storage: StorageOf
	hooks?: DialecteHooks<AnyDialecteConfig>
	name?: string
	dialecteId?: string
}): Promise<Project<AnyDialecteConfig>> {
	const {
		storage,
		hooks,
		name = `store-switch-${crypto.randomUUID()}`,
		dialecteId = DIALECTE_ID,
	} = params
	const project = await new Project({
		configs: { default: CONFIG },
		storage: await storage({ name, dialecteId, hooks }),
		hooks,
		dialecteId,
	}).open(name)
	opened.push(project)
	return project
}

/** Every message a project's channel tells its listeners, kept for the case. */
function channelHeard(params: { project: Project<AnyDialecteConfig> }): ProjectChannelMessage[] {
	const heard: ProjectChannelMessage[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function keep(event: MessageEvent<ProjectChannelMessage>) {
		heard.push(event.data)
	}
	listeners.push(channel)
	return heard
}

/** The channels the cases listened on: closed after each. */
const listeners: BroadcastChannel[] = []

/** A message as a case compares it: its type and the document it names. */
function subjectOf(message: ProjectChannelMessage): { type: string; documentId?: string } {
	return {
		type: message.type,
		...('documentId' in message && { documentId: message.documentId }),
	}
}

/** Changes ordered by the document they name. */
function byDocument(first: { documentId?: string }, second: { documentId?: string }): number {
	return (first.documentId ?? '').localeCompare(second.documentId ?? '')
}

/** A commit through a project's document: one child added under its root. */
async function addChild(params: {
	project: Project<AnyDialecteConfig>
	documentId: string
}): Promise<void> {
	await params.project.openDocument(params.documentId).transaction(async function add(tx) {
		const root = await tx.getRoot()
		await tx.addChild(root, { tagName: 'A', attributes: [] })
	})
}

const CASES: Record<
	string,
	BaseTestCase & {
		act: (storage: StorageOf) => Promise<void>
		/** The storages answering otherwise by design, each with why: the case is skipped there. */
		differs?: Record<string, string>
	}
> = {
	'an import hook rewrites a text value → the export carries the hook’s text': {
		act: async function hookTextReachesExport(storage) {
			const project = await openProject({ storage, hooks: TEXT_WRITING_HOOKS })
			const { documentId } = await project.importFile(leafFile())

			const { file } = await project.export({ documentId, indent: false })
			const xml = await file.text()
			const leafText = withXmlDocument({ xml, label: 'the export' }, function readLeaf(document) {
				return selectFirstNode({
					context: document,
					expression: '//*[local-name() = "CCCC_1"]',
					namespaces: {},
				})?.content
			})
			expect(leafText).toBe(HOOK_TEXT)
		},
	},
	'a project closed, then a new project opened under its name → the document is there, its records read':
		{
			act: async function reopenByName(storage) {
				const first = await openProject({ storage })
				const { documentId } = await first.importFile(leafFile())
				await first.close()

				const second = await openProject({ storage, name: first.name })

				const documents = await second.getDocuments()
				expect(documents.map((document) => document.id)).toEqual([documentId])
				const [leaf] = await second.openDocument(documentId).query.getRecordsByTagName('CCCC_1')
				expect(leaf?.value).toBe('as imported')
			},
		},
	'a destroy refused while another project of the name is open → nothing removed, the project closed; the other closed → destroyed when called again':
		{
			act: async function destroyRefusedThenAgain(storage) {
				const project = await openProject({ storage })
				const { documentId } = await project.importFile(leafFile())
				const other = await openProject({ storage, name: project.name })

				await expect(project.destroy()).rejects.toMatchObject({
					cause: { key: 'PROJECT_OPEN_ELSEWHERE' },
				})

				const documents = await other.getDocuments()
				expect(documents.map((document) => document.id)).toEqual([documentId])
				await expect(project.getDocuments()).rejects.toMatchObject({
					cause: { key: 'PROJECT_NOT_OPENED' },
				})
				await other.close()
				await project.destroy()
				const fresh = await openProject({ storage, name: project.name })
				expect(await fresh.getDocuments()).toEqual([])
			},
		},
	'a commit by another project of the name → this project’s document takes it, its view woken; each project’s channel tells each change once':
		{
			act: async function crossProjectCommit(storage) {
				const project = await openProject({ storage })
				const { documentId } = await project.importFile(leafFile())
				const other = await openProject({ storage, name: project.name })
				await other.getDocumentStatus(documentId)
				const heardHere = channelHeard({ project })
				const heardThere = channelHeard({ project: other })
				let woken = 0
				project.openDocument(documentId).subscribe(function wake() {
					woken += 1
				})

				await addChild({ project: other, documentId })
				await addChild({ project, documentId })

				const expected = [
					{ type: 'commit', documentId },
					{ type: 'commit', documentId },
				]
				await vi.waitFor(
					function eachToldOnce() {
						expect(heardHere.map(subjectOf)).toEqual(expected)
						expect(heardThere.map(subjectOf)).toEqual(expected)
						expect(woken).toBeGreaterThan(0)
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
				expect(project.state.documents.get(documentId)?.canUndo).toBe(true)
			},
		},
	'two commits of one project at once, on two documents → each told once on its channel and on the other project’s':
		{
			act: async function concurrentCommits(storage) {
				const project = await openProject({ storage })
				const { documentId: first } = await project.importFile(leafFile())
				const { documentId: second } = await project.importFile(leafFile())
				const other = await openProject({ storage, name: project.name })
				await other.getDocumentStatus(first)
				const heardHere = channelHeard({ project })
				const heardThere = channelHeard({ project: other })

				await Promise.all([
					addChild({ project, documentId: first }),
					addChild({ project, documentId: second }),
				])

				const expected = [
					{ type: 'commit', documentId: first },
					{ type: 'commit', documentId: second },
				].toSorted(byDocument)
				await vi.waitFor(
					function bothToldOnce() {
						expect(heardHere.map(subjectOf).toSorted(byDocument)).toEqual(expected)
						expect(heardThere.map(subjectOf).toSorted(byDocument)).toEqual(expected)
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			},
		},
	'an undo with nothing to undo in one project → nothing told on its channel nor on the other project’s':
		{
			differs: { 'on IndexedDB': INDEXEDDB_ANNOUNCES_NOTHING },
			act: async function silentUndo(storage) {
				const project = await openProject({ storage })
				const { documentId } = await project.importFile(leafFile())
				const other = await openProject({ storage, name: project.name })
				const heardHere = channelHeard({ project })
				const heardThere = channelHeard({ project: other })

				await project.undo(documentId)
				// nothing to wait for: a bounded wait, longer than a message takes on a loaded machine
				await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))

				expect(heardHere).toEqual([])
				expect(heardThere).toEqual([])
			},
		},
	'two dialectes’ projects of one name → a change in one told to no listener of the other': {
		differs: { 'on IndexedDB': INDEXEDDB_KEYED_BY_NAME },
		act: async function dialectesApart(storage) {
			const project = await openProject({ storage })
			const other = await openProject({
				storage,
				name: project.name,
				dialecteId: 'core/test-other',
			})
			const heardThere = channelHeard({ project: other })

			await project.importFile(leafFile())
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))

			expect(heardThere).toEqual([])
			expect(await other.getDocuments()).toEqual([])
		},
	},
	'a document renamed through another store of the project → the project’s record renamed, document-updated told':
		{
			differs: { 'on IndexedDB': INDEXEDDB_ANNOUNCES_NOTHING },
			act: async function renamedElsewhere(storage) {
				const project = await openProject({ storage })
				const { documentId } = await project.importFile(leafFile())
				const heard = channelHeard({ project })
				// a store of the project of its own (not a project): it writes, the project hears
				const other = resolveStore({
					name: project.name,
					dialecteId: DIALECTE_ID,
					storage: await storage({ name: project.name, dialecteId: DIALECTE_ID }),
					runtime: { configs: { default: CONFIG }, defaultConfigKey: 'default' },
				})
				await other.open()
				await other.updateDocument(documentId, { name: 'renamed' })
				await other.close()

				await vi.waitFor(
					function renamedHere() {
						expect(project.state.documents.get(documentId)?.record.name).toBe('renamed')
						expect(heard.map(subjectOf)).toEqual([{ type: 'document-updated', documentId }])
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			},
		},
	'an undo in another project of the name → this project’s history status follows, its channel tells it':
		{
			act: async function undoneElsewhere(storage) {
				const project = await openProject({ storage })
				const { documentId } = await project.importFile(leafFile())
				const other = await openProject({ storage, name: project.name })
				await other.getDocumentStatus(documentId)
				await addChild({ project, documentId })
				const heard = channelHeard({ project })

				await other.undo(documentId)

				await vi.waitFor(
					function undoneHere() {
						expect(heard.map(subjectOf)).toEqual([{ type: 'commit', documentId }])
						expect(project.state.documents.get(documentId)?.canUndo).toBe(false)
						expect(project.state.documents.get(documentId)?.canRedo).toBe(true)
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			},
		},
	'an import, then a removal, in another project of the name → this project’s documents follow, its channel tells both':
		{
			act: async function importedAndRemovedElsewhere(storage) {
				const project = await openProject({ storage })
				const other = await openProject({ storage, name: project.name })
				const heard = channelHeard({ project })

				const { documentId } = await other.importFile(leafFile())
				await vi.waitFor(
					function importedHere() {
						expect(project.state.documents.has(documentId)).toBe(true)
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
				await other.removeDocument(documentId)

				await vi.waitFor(
					function removedHere() {
						expect(project.state.documents.has(documentId)).toBe(false)
						expect(heard.map(subjectOf)).toEqual([
							{ type: 'document-imported', documentId },
							{ type: 'document-removed', documentId },
						])
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			},
		},
	'a destroyed project → getDocuments rejects with PROJECT_NOT_OPENED': {
		act: async function readAfterDestroy(storage) {
			const project = await openProject({ storage })
			await project.importFile(leafFile())

			await project.destroy()

			await expect(project.getDocuments()).rejects.toMatchObject({
				cause: { key: 'PROJECT_NOT_OPENED' },
			})
		},
	},
}

describe('Project - the same on every store', () => {
	afterEach(async () => {
		for (const channel of listeners.splice(0)) channel.close()
		const projects = opened.splice(0)
		// every one closed first: a project is destroyed only once no other connection has it open
		for (const project of projects) await project.close()
		for (const project of projects) await project.destroy()
	})

	for (const [storageName, storage] of Object.entries(STORAGES)) {
		describe(storageName, () => {
			for (const [description, testCase] of Object.entries(CASES)) {
				const differs = testCase.differs?.[storageName]
				if (differs) {
					it.skip(`${description} (differs here: ${differs})`)
					continue
				}
				const testFn = testCase.only ? it.only : it
				testFn(description, () => testCase.act(storage))
			}
		})
	}
})
