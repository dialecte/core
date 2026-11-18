import { Project } from './project'
import { SWITCH_CONFIG, SWITCH_DIALECTE_ID, SWITCH_STORAGES } from './store-switch.fixtures'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { CommitChanges, ProjectChannelMessage, UnknownCommitChanges } from './types'
import type { AnyDialecteConfig } from '@/types'

// The store is a switch: a commit, its undo and its redo reach a second project of the name with the writer's
// changes on every storage, and a step with nothing to step tells nothing.

type Changes = CommitChanges | UnknownCommitChanges
type StorageOf = (typeof SWITCH_STORAGES)[string]

/** The Project's read epoch of a document: moved each time its read scopes are voided. */
type ProjectInternals = { readEpochOf: (documentId: string) => number }

const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const SOURCE_XML = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root">
		<A ${customId}="a">
			<AA_1 ${customId}="aa1"><AAA_1 ${customId}="aaa1" aAAA_1="abc"/></AA_1>
		</A>
		<B ${customId}="b" />
	</Root>
`

/** The source as a file to import, its records keeping their ids. */
function sourceFile(): File {
	return new File([SOURCE_XML], 'source.xml', { type: 'text/xml' })
}

const opened: Project<AnyDialecteConfig>[] = []
const listeners: BroadcastChannel[] = []

async function openProject(params: {
	storage: StorageOf
	name: string
}): Promise<Project<AnyDialecteConfig>> {
	const { storage, name } = params
	const projectStorage = await storage({ name, dialecteId: SWITCH_DIALECTE_ID })
	const project = await new Project({
		configs: { default: SWITCH_CONFIG },
		storage: projectStorage,
		dialecteId: SWITCH_DIALECTE_ID,
	}).open(name)
	opened.push(project)
	return project
}

/** The changes of every commit message the project's listeners hear, in order. */
function commitsHeard(params: { project: Project<AnyDialecteConfig> }): Changes[] {
	const heard: Changes[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function keep(event: MessageEvent<ProjectChannelMessage>) {
		if (event.data.type === 'commit') heard.push(sorted(event.data.changes))
	}
	listeners.push(channel)
	return heard
}

function byId(left: { id: string }, right: { id: string }): number {
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** The changes with every list sorted by id: the order inside a list is not the contract. */
function sorted(changes: Changes): Changes {
	if ('unknown' in changes) return changes
	return {
		created: [...changes.created].sort(byId),
		updated: [...changes.updated].sort(byId),
		deleted: [...changes.deleted].sort(byId),
	}
}

/** What undoing those changes tells: the deleted created again, the created deleted, the updated as they were. */
function inverseOf(changes: CommitChanges): CommitChanges {
	return { created: changes.deleted, updated: changes.updated, deleted: changes.created }
}

const CASES: Record<string, (storage: StorageOf) => Promise<void>> = {
	'a commit with a delete, its undo, its redo → a second project hears each with the writer’s changes':
		async function heardByTheSecond(storage) {
			const name = `history-changes-${crypto.randomUUID()}`
			const writer = await openProject({ storage, name })
			const { documentId } = await writer.importFile(sourceFile(), { useCustomRecordsIds: true })
			const reader = await openProject({ storage, name })
			const written = commitsHeard({ project: writer })
			const heard = commitsHeard({ project: reader })

			// B updated, AAA_1 deleted from AA_1 (AA_1 updated)
			await writer.openDocument(documentId).transaction(async (tx) => {
				await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: 'changed' } })
				await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
			})
			await writer.undo(documentId)
			await writer.redo(documentId)

			const committed: CommitChanges = {
				created: [],
				updated: [
					{ id: 'aa1', tagName: 'AA_1', parentId: 'a' },
					{ id: 'b', tagName: 'B', parentId: 'root' },
				],
				deleted: [{ id: 'aaa1', tagName: 'AAA_1', parentId: 'aa1' }],
			}
			const expected = [committed, inverseOf(committed), committed]
			await vi.waitFor(function everyStepHeard() {
				expect({ written, heard }).toEqual({ written: expected, heard: expected })
			})
		},
	'project.undo and redo with nothing to step → nothing posted, no state change signalled':
		async function silentStep(storage) {
			const name = `history-changes-${crypto.randomUUID()}`
			const project = await openProject({ storage, name })
			const { documentId } = await project.importFile(sourceFile(), { useCustomRecordsIds: true })
			const heard = commitsHeard({ project })
			const signals: boolean[] = []
			project.openDocument(documentId).subscribe(function signalled(terminal) {
				signals.push(terminal)
			})

			await project.undo(documentId)
			await project.redo(documentId)
			await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))

			expect({ heard, signals }).toEqual({ heard: [], signals: [] })
		},
	'project.undo and redo with nothing to step → the read scopes kept; a step that applied voids them':
		async function scopesKept(storage) {
			const name = `history-changes-${crypto.randomUUID()}`
			const project = await openProject({ storage, name })
			const { documentId } = await project.importFile(sourceFile(), { useCustomRecordsIds: true })
			const internals = project as unknown as ProjectInternals
			const before = internals.readEpochOf(documentId)

			await project.undo(documentId)
			await project.redo(documentId)
			const afterNothing = internals.readEpochOf(documentId)
			await project.openDocument(documentId).transaction(async (tx) => {
				await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: 'changed' } })
			})
			const afterCommit = internals.readEpochOf(documentId)
			await project.undo(documentId)
			const afterUndo = internals.readEpochOf(documentId)

			expect({ kept: afterNothing === before, moved: afterUndo > afterCommit }).toEqual({
				kept: true,
				moved: true,
			})
		},
}

describe('Project - a commit, an undo and a redo told with their changes on every store', () => {
	afterEach(async () => {
		for (const channel of listeners.splice(0)) channel.close()
		const projects = opened.splice(0)
		// every one closed first: a project is destroyed only once no other connection has it open
		for (const project of projects) await project.close()
		for (const project of projects) await project.destroy()
	})

	for (const [storageName, storage] of Object.entries(SWITCH_STORAGES)) {
		describe(storageName, () => {
			for (const [description, act] of Object.entries(CASES)) {
				it(description, () => act(storage))
			}
		})
	}
})
