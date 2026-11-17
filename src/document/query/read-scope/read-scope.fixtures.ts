import { defineDialecte } from '@/dialecte'
import { createDialecteProject } from '@/dialecte/create-dialecte-project'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { createTestHelpers } from '@/test/create-test-helpers'

import type { Store } from '@/store'
import type { TestDialecteConfig } from '@/test'
import type { AnyRawRecord } from '@/types'

/** One versioned read the store answered: its member and its first argument. */
export type VersionedReadLog = { member: string; first: unknown }[]

/** The query a probe verb is given: the reads it calls, untyped. */
type ProbeQuery = {
	getRecord: (ref: unknown) => Promise<AnyRawRecord | undefined>
	getRecords: (refs: unknown[]) => Promise<(AnyRawRecord | undefined)[]>
	getRecordsByTagName: (tagName: string) => Promise<AnyRawRecord[]>
	getAttribute: (ref: unknown, params: { name: string }) => Promise<string>
	any: { getRecord: (ref: unknown) => Promise<AnyRawRecord | undefined> }
	probe: { readTwice: (ref: unknown) => Promise<(AnyRawRecord | undefined)[]> }
}

/** Query verbs that read inside one call, as an extension module does. */
export const PROBE_EXTENSIONS = {
	probe: {
		query: {
			readTwice: async function readTwice(query: ProbeQuery, ref: unknown) {
				return [await query.getRecord(ref), await query.getRecord(ref)]
			},
			readThroughNested: async function readThroughNested(query: ProbeQuery, ref: unknown) {
				await query.getRecord(ref)
				return query.probe.readTwice(ref)
			},
			readWithCoreMethods: async function readWithCoreMethods(query: ProbeQuery, ref: unknown) {
				return [await query.getAttribute(ref, { name: 'aA' }), await query.getRecord(ref)]
			},
			readTagThenRecord: async function readTagThenRecord(query: ProbeQuery, ref: unknown) {
				await query.getRecordsByTagName('A')
				return query.getRecord(ref)
			},
			readOneThenBoth: async function readOneThenBoth(query: ProbeQuery, refs: [unknown, unknown]) {
				await query.getRecord(refs[0])
				return query.getRecords(refs)
			},
			mutateThenRead: async function mutateThenRead(query: ProbeQuery, ref: unknown) {
				const first = await query.getRecord(ref)
				if (first) first.attributes[0].value = 'mutated'
				return query.getRecord(ref)
			},
			readViaAny: async function readViaAny(query: ProbeQuery, ref: unknown) {
				return [await query.getRecord(ref), await query.any.getRecord(ref)]
			},
			readAround: async function readAround(
				query: ProbeQuery,
				params: { ref: unknown; other: unknown; write: () => Promise<void> },
			) {
				const before = await query.getAttribute(params.ref, { name: 'aA' })
				await query.getAttribute(params.ref, { name: 'aA' })
				await params.write()
				await query.getRecord(params.other)
				const after = await query.getAttribute(params.ref, { name: 'aA' })
				return [before, after]
			},
			keepQuery: function keepQuery(query: ProbeQuery) {
				return query
			},
		},
	},
}

/**
 * The store with `readVersioned` answered from its own read members: the version is taken before the read starts
 * (a write landing meanwhile can only make the scope drop what it holds, never keep an old answer), and it moves on
 * every write unless `frozen` (so only the Project's read epoch can void a scope). Every versioned read is logged;
 * `gate`, when given, is awaited before each one is answered.
 */
export function versionedStore(params: {
	store: Store
	log: VersionedReadLog
	frozen?: boolean
	gate?: () => Promise<void>
}): Store {
	const { store, log, frozen = false, gate } = params
	const writes = new Set(['commit', 'undo', 'redo', 'bulkWrite', 'removeDocument', 'importFile'])
	let count = 0
	return new Proxy(store, {
		get: function memberOfStore(target, property) {
			if (property === 'readVersioned') {
				return async function readVersioned(read: {
					documentId: string
					read: { member: string; args: unknown[] }
				}) {
					const version = { engineId: 'fixture', count }
					log.push({ member: read.read.member, first: read.read.args[0] })
					await gate?.()
					const member = Reflect.get(target, read.read.member, target) as (
						...args: unknown[]
					) => Promise<unknown>
					const value = await member.apply(target, read.read.args)
					return { value, version }
				}
			}
			const member: unknown = Reflect.get(target, property, target)
			if (typeof member !== 'function') return member
			if (!writes.has(String(property))) return member.bind(target)
			return async function write(...args: unknown[]) {
				const answer = await (member as (...args: unknown[]) => Promise<unknown>).apply(
					target,
					args,
				)
				if (!frozen) count++
				return answer
			}
		},
	})
}

/** An in-memory store of the test dialecte under `name`, not opened (the Project opens it). */
export function inMemoryTestStore(params: { name: string }): InMemoryStore {
	return new InMemoryStore(params.name, {
		dialecteId: READ_SCOPE_DIALECTE.id,
		runtime: {
			configs: READ_SCOPE_DIALECTE.configs,
			defaultConfigKey: READ_SCOPE_DIALECTE.defaultConfigKey,
		},
	})
}

/** The test dialecte with the probe verbs. */
export const READ_SCOPE_DIALECTE = defineDialecte({
	id: 'core/test',
	version: '0.0.0',
	configs: { test: TEST_DIALECTE_CONFIG as TestDialecteConfig },
	defaultConfigKey: 'test',
	extensions: PROBE_EXTENSIONS,
})

const helpers = createTestHelpers({ dialecte: READ_SCOPE_DIALECTE })

/**
 * A project of `sourceXml` (two `A` elements holding `aA` one and two) over `store`, the refs of its two `A` records,
 * read before the case, and the log emptied.
 */
export async function openScopedProject(params: {
	store: Store
	log: VersionedReadLog
	sourceXml: string
}) {
	const { project, source } = await helpers.createTestProject({
		sourceXml: params.sourceXml,
		storage: { type: 'custom', store: params.store },
	})
	const records = await source.document.query.getRecordsByTagName('A')
	const first = refOfValue({ records, value: 'one' })
	const second = refOfValue({ records, value: 'two' })
	params.log.length = 0
	return { project, document: source.document, first, second }
}

/** A second Project of the read-scope dialecte over `store` (one sharing another Project's state), opened, nothing imported. */
export async function openOtherProject(params: { store: Store }) {
	return createDialecteProject({
		dialecte: READ_SCOPE_DIALECTE,
		storage: { type: 'custom', store: params.store },
	}).open(`read-scope-${crypto.randomUUID()}`)
}

/** The ref of the `A` record holding `aA` with `value`. */
function refOfValue(params: { records: AnyRawRecord[]; value: string }): {
	tagName: 'A'
	id: string
} {
	const { id } = params.records.find((record) => record.attributes[0]?.value === params.value)!
	return { tagName: 'A', id }
}
