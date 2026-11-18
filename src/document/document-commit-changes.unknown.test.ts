import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { Project } from '@/project'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'
import { createSeededRandomUuid } from '@/utils'

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

async function openOn(params: { store: Store; name: string }): Promise<Project<AnyDialecteConfig>> {
	const project = await new Project({
		configs: { default: CONFIG },
		storage: { type: 'custom', store: params.store },
	}).open(params.name)
	onTestFinished(function closeProject() {
		return project.close()
	})
	return project
}

async function openWithDocument(params: { store: Store; name?: string }) {
	const name = params.name ?? `commit-changes-${crypto.randomUUID()}`
	const project = await openOn({ store: params.store, name })
	const xml = `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root"><B ${customId}="b"/></Root>`
	const { documentId } = await project.importFile(new File([xml], 'source.xml'), {
		useCustomRecordsIds: true,
	})
	return { project, documentId, doc: project.openDocument(documentId) }
}

/** What updating B tells: B updated under the root (an undo of it tells the same). */
const B_UPDATED = {
	created: [],
	updated: [{ id: 'b', tagName: 'B', parentId: 'root' }],
	deleted: [],
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

	it('undo and redo -> the commit’s inverse, then its changes (no longer unknown)', async () => {
		const store = new InMemoryStore('undo-redo', { runtime: RUNTIME })
		made.push(store)
		const { project, documentId, doc } = await openWithDocument({ store })
		await updateB({ doc })
		const heard = commitsHeard({ project })

		await project.undo(documentId)
		await project.redo(documentId)

		await vi.waitFor(function stepsHeard() {
			expect(heard.map((message) => message.changes)).toEqual([B_UPDATED, B_UPDATED])
		})
	})

	it('a commit, its undo and its redo under a seeded crypto.randomUUID -> none draws from it: the next record gets the first seeded id', async () => {
		const store = new InMemoryStore('seeded-ids', { runtime: RUNTIME })
		made.push(store)
		const { project, documentId, doc } = await openWithDocument({ store })
		const heard = commitsHeard({ project })
		const page = crypto.randomUUID
		crypto.randomUUID = createSeededRandomUuid({ seed: 0 })
		onTestFinished(function restoreUuids() {
			crypto.randomUUID = page
		})

		await updateB({ doc })
		await project.undo(documentId)
		await project.redo(documentId)
		await doc.transaction(async (tx) => {
			await tx.addChild({ tagName: 'B', id: 'b' }, { tagName: 'BB_1', attributes: {} })
		})

		await vi.waitFor(function fourHeard() {
			expect(heard).toHaveLength(4)
		})
		const created = heard[3]!.changes
		expect('created' in created && created.created.map((record) => record.id)).toEqual([
			createSeededRandomUuid({ seed: 0 })(),
		])
	})

	it('prepare().commit() refused with its connection lost, maybe applied -> { unknown: true }', async () => {
		const name = `lost-prepared-${crypto.randomUUID()}`
		const { project, doc } = await openWithDocument({
			store: losingStore({ name, outcome: 'refused' }),
		})
		const heard = commitsHeard({ project })
		const prepared = await doc.prepare(async (tx) => {
			await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: 'changed' } })
		})

		await expect(prepared.commit()).rejects.toThrow()

		await vi.waitFor(function lossHeard() {
			expect(heard.map((message) => message.changes)).toEqual([{ unknown: true }])
		})
	})

	it('another connection’s commit, told by the store -> heard through the Project with the writer’s changes', async () => {
		const name = `two-connections-${crypto.randomUUID()}`
		const writerStore = new InMemoryStore(name, { runtime: RUNTIME })
		const listenerStore = new InMemoryStore(name, { runtime: RUNTIME })
		// destroyed after the case once the listener's connection is closed: a store is not destroyed while another
		// connection holds the project
		made.push(writerStore)
		const writer = await openWithDocument({ store: writerStore, name })
		const listener = await openOn({ store: listenerStore, name })
		try {
			await listener.getDocumentStatus(writer.documentId)
			const heard = commitsHeard({ project: listener })

			await updateB({ doc: writer.doc })

			await vi.waitFor(function toldHeard() {
				expect(heard.map((message) => message.changes)).toEqual([B_UPDATED])
			})
		} finally {
			await listener.close()
		}
	})
})
