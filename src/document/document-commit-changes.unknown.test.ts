import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { Project } from '@/project'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { ProjectChannelMessage } from '@/project/types'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

type CommitMessage = Extract<ProjectChannelMessage, { type: 'commit' }>

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The stores a case made: destroyed after it. */
const made: Store[] = []

afterEach(async () => {
	for (const store of made.splice(0)) await store.destroy()
})

function lost(params: { writeId: string }): Error {
	return createDialecteError('STORE_CONNECTION_LOST', {
		detail: 'its host went while the commit waited',
		meta: { reason: 'host-gone', writeId: params.writeId },
	})
}

/**
 * An in-memory store telling no change (no `subscribe`: the Project posts its own), whose first commit lands, then is
 * refused `STORE_CONNECTION_LOST`; `outcome` what the ask of that write's outcome answers: `applied` (the store's own
 * answer) or refused too (its outcome unknown).
 */
function losingStore(params: { name: string; outcome: 'applied' | 'refused' }): Store {
	const store = new InMemoryStore(params.name, { runtime: RUNTIME })
	made.push(store)
	const commit = store.commit.bind(store)
	let losses = 1
	store.commit = async function landedThenLost(commitParams) {
		await commit(commitParams)
		if (losses <= 0) return
		losses -= 1
		throw lost({ writeId: commitParams.writeId ?? '' })
	}
	if (params.outcome === 'refused') {
		store.getWriteOutcome = async function outcomeLostToo() {
			throw lost({ writeId: '' })
		}
	}
	const tellingNothing: Store = store
	tellingNothing.subscribe = undefined
	return store
}

function commitsHeard(params: { project: Project<AnyDialecteConfig> }): CommitMessage[] {
	const heard: CommitMessage[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function hear(event: MessageEvent<ProjectChannelMessage>) {
		if (event.data.type === 'commit') heard.push(event.data)
	}
	onTestFinished(function closeChannel() {
		channel.close()
	})
	return heard
}

async function openWithDocument(params: { store: Store }) {
	const name = `commit-changes-${crypto.randomUUID()}`
	const project = await new Project({
		configs: { default: CONFIG },
		storage: { type: 'custom', store: params.store },
	}).open(name)
	onTestFinished(function closeProject() {
		return project.close()
	})
	const xml = `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root"><B ${customId}="b"/></Root>`
	const { documentId } = await project.importFile(new File([xml], 'source.xml'), {
		useCustomRecordsIds: true,
	})
	return { project, documentId, doc: project.openDocument(documentId) }
}

async function updateB(params: { doc: ReturnType<Project<AnyDialecteConfig>['openDocument']> }) {
	await params.doc.transaction(async (tx) => {
		await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: 'changed' } })
	})
}

describe('commit changes not known', () => {
	it('a commit refused with its connection lost, maybe applied or applied -> { unknown: true }, or its exact changes when applied', async () => {
		const maybe = await openWithDocument({
			store: losingStore({ name: 'lost-maybe', outcome: 'refused' }),
		})
		const heardMaybe = commitsHeard({ project: maybe.project })
		await expect(updateB({ doc: maybe.doc })).rejects.toThrow()

		const applied = await openWithDocument({
			store: losingStore({ name: 'lost-applied', outcome: 'applied' }),
		})
		const heardApplied = commitsHeard({ project: applied.project })
		await updateB({ doc: applied.doc })

		await vi.waitFor(function bothHeard() {
			expect(heardMaybe.map((message) => message.changes)).toEqual([{ unknown: true }])
			expect(heardApplied.map((message) => message.changes)).toEqual([
				{ created: [], updated: [{ id: 'b', tagName: 'B', parentId: 'root' }], deleted: [] },
			])
		})
	})

	it('undo, redo and a store announcement of a commit, undo, redo, bulk write -> { unknown: true }', async () => {
		const store = new InMemoryStore('undo-redo', { runtime: RUNTIME })
		made.push(store)
		const { project, documentId, doc } = await openWithDocument({ store })
		await updateB({ doc })
		const heard = commitsHeard({ project })

		await project.undo(documentId)
		await project.redo(documentId)

		await vi.waitFor(function stepsHeard() {
			expect(heard.map((message) => message.changes)).toEqual([
				{ unknown: true },
				{ unknown: true },
			])
		})
	})
})
