import { gateStore } from './gated-store'
import { installLossyChannel } from './lossy-channel'
import { openRawStore } from './raw-store'

import { afterEach, describe, it } from 'vitest'

import { Project } from '@/project/project'

import type {
	ReadModelCase,
	ReadModelContext,
	ReadModelStorage,
	RunReadModelCasesParams,
} from './read-model-harness.types'
import type { OpenedByCase } from './read-model-internal.types'
import type { StorageParam } from '@/project/types'
import type { AnyDialecteConfig } from '@/types'

/**
 * Runs read-model cases on every store given, one at a time: per case, a writer project imports the source and a
 * reader project of the same name opens it through a gate, with the realm's channel made lossy; after it, whatever it
 * left held is released and both projects are closed and destroyed. A case meant for the other kind of store (one that
 * announces, or one that does not) is reported skipped on this one.
 *
 * @intent prove a read cache against the uncached path on every store
 */
export function runReadModelCases(params: RunReadModelCasesParams): void {
	const { title, storages, cases } = params
	const opened: OpenedByCase = { projects: [], stores: [], channels: [], gates: [] }

	describe(title, () => {
		afterEach(async function closeEverything() {
			await closeOpened({ opened })
		})

		for (const [storageName, storage] of Object.entries(storages)) {
			describe(storageName, () => {
				for (const readModelCase of cases) {
					it(readModelCase.title, async ({ skip }) => {
						const context = await openContext({ params, storage, opened })
						if (!appliesTo({ readModelCase, context })) skip()
						await readModelCase.act(context)
					})
				}
			})
		}
	})
}

function appliesTo(params: { readModelCase: ReadModelCase; context: ReadModelContext }): boolean {
	const { readModelCase, context } = params
	return readModelCase.announces === undefined || readModelCase.announces === context.announces
}

/** The writer with the source imported, the reader through a gate, a store held directly, the lossy channel. */
async function openContext(params: {
	params: RunReadModelCasesParams
	storage: ReadModelStorage
	opened: OpenedByCase
}): Promise<ReadModelContext> {
	const { storage, opened } = params
	const { config, dialecteId, sourceXml } = params.params
	const name = `read-model-${crypto.randomUUID()}`
	// before any project opens: their channels are made from it
	const channel = installLossyChannel()
	opened.channels.push(channel)
	const writerStorage = await storage({ name, dialecteId })
	const writer = await openProject({ storage: writerStorage, name, config, dialecteId })
	opened.projects.push(writer)
	const file = new File([sourceXml], 'source.xml', { type: 'text/xml' })
	const { documentId } = await writer.importFile(file, { useCustomRecordsIds: true })
	// the reader's project opens its store itself
	const readerStore = await openRawStore({ storage, name, dialecteId, config, open: false })
	const gate = gateStore({ store: readerStore })
	opened.gates.push(gate)
	const reader = await openProject({
		storage: { type: 'custom', store: gate.store },
		name,
		config,
		dialecteId,
	})
	opened.projects.push(reader)
	const around = await openRawStore({ storage, name, dialecteId, config })
	opened.stores.push(around)
	return {
		writer,
		reader,
		documentId,
		gate,
		announces: typeof readerStore.subscribe === 'function',
		channel,
		around,
		config,
	}
}

async function openProject(params: {
	storage: StorageParam
	name: string
	config: AnyDialecteConfig
	dialecteId: string
}): Promise<Project<AnyDialecteConfig>> {
	const { storage, name, config, dialecteId } = params
	return new Project({ configs: { default: config }, storage, dialecteId }).open(name)
}

/**
 * What a case left held released first (a held store call would keep its store from closing), then every store held
 * directly closed, every project closed (all first) and destroyed, the channel restored.
 */
async function closeOpened(params: { opened: OpenedByCase }): Promise<void> {
	const { opened } = params
	for (const gate of opened.gates.splice(0)) gate.releaseAll()
	for (const store of opened.stores.splice(0)) await store.close()
	const projects = opened.projects.splice(0)
	for (const project of projects) await project.close()
	for (const project of projects) await project.destroy()
	for (const channel of opened.channels.splice(0)) channel.restore()
}
