import { HARNESS_TRACKED } from './read-model-harness.fixtures.constants'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { Project } from '@/project/project'
import { SWITCH_CONFIG, SWITCH_DIALECTE_ID } from '@/project/store-switch.fixtures'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test/constant'

import type { HarnessTracked, OpenedSource } from './read-model-harness.fixtures.types'
import type { StorageParam } from '@/project/types'
import type { Store } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'

// The harness tests' own setup: an in-memory project holding B, a store of its name held directly, what to close.

/** What the test file opened (each test file loads its own copy of this module), closed after each case. */
export function trackedOfFile(): HarnessTracked {
	return HARNESS_TRACKED
}

/** Every restore run, every store closed, every project closed (all first) and destroyed. */
export async function closeTracked(): Promise<void> {
	const tracked = HARNESS_TRACKED
	for (const restore of tracked.restores.splice(0)) restore()
	for (const store of tracked.stores.splice(0)) await store.close()
	const projects = tracked.projects.splice(0)
	for (const project of projects) await project.close()
	for (const project of projects) await project.destroy()
}

export async function inMemoryStorage(): Promise<StorageParam> {
	return { type: 'inMemory' }
}

/** A project holding B (`aB="first"`), and a store of its name held directly; both closed after the case. */
export async function openSource(): Promise<OpenedSource> {
	const tracked = HARNESS_TRACKED
	const name = `read-model-harness-${crypto.randomUUID()}`
	const project = await new Project({
		configs: { default: SWITCH_CONFIG },
		storage: { type: 'inMemory' },
		dialecteId: SWITCH_DIALECTE_ID,
	}).open(name)
	tracked.projects.push(project)
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE
	const sourceXml = /* xml */ `
		<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root">
			<B ${customId}="b" aB="first" />
		</Root>
	`
	const file = new File([sourceXml], 'source.xml', { type: 'text/xml' })
	const { documentId } = await project.importFile(file, { useCustomRecordsIds: true })
	const store = new InMemoryStore(name, {
		dialecteId: SWITCH_DIALECTE_ID,
		runtime: { configs: { default: SWITCH_CONFIG }, defaultConfigKey: 'default' },
	})
	await store.open()
	tracked.stores.push(store)
	return { store, documentId, name }
}

/** B as stored, with `aB` set to `value`. */
export async function bWith(params: {
	store: Store
	documentId: string
	value: string
}): Promise<AnyRawRecord> {
	const { store, documentId, value } = params
	const stored = await store.get('b', documentId)
	if (!stored) throw new Error('the source holds B')
	const others = stored.attributes.filter((attribute) => attribute.name !== 'aB')
	return { ...stored, attributes: [...others, { name: 'aB', value }] }
}

export function aBOf(record: AnyRawRecord | undefined): string | undefined {
	return record?.attributes.find((attribute) => attribute.name === 'aB')?.value
}

/** What the case observes, asserted whole: a stub's error then fails inside the matcher. */
export function observed<GenericOutcome>(
	observe: () => Promise<GenericOutcome> | GenericOutcome,
): Promise<GenericOutcome> {
	return Promise.resolve().then(observe)
}
