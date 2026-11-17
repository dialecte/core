import { defineDialecte } from '@/dialecte'
import { createDialecteProject } from '@/dialecte/create-dialecte-project'
import { createDialecteError } from '@/errors'
import { NOOP_PERF } from '@/perf'
import { InMemoryStore } from '@/store'
import { cloneRecord } from '@/store/in-memory/clone-record'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { createTestHelpers } from '@/test/create-test-helpers'

import type { ReadScope, VersionedRead } from './read-scope.types'
import type { Context } from '@/document'
import type { Store } from '@/store'
import type { TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

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
			readRecordAround: async function readRecordAround(
				query: ProbeQuery,
				params: { ref: unknown; write: () => Promise<void> },
			) {
				const before = await query.getRecord(params.ref)
				await query.getRecord(params.ref)
				await params.write()
				const after = await query.getRecord(params.ref)
				return [before?.attributes[0]?.value, after?.attributes[0]?.value]
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
 * `gate`, when given, is awaited before each one is answered. A write member named in `losing` lands, then is refused
 * `STORE_CONNECTION_LOST`, and the ask of its outcome is refused too (what became of it is not known).
 */
export function versionedStore(params: {
	store: Store
	log: VersionedReadLog
	frozen?: boolean
	gate?: () => Promise<void>
	losing?: ReadonlySet<string>
}): Store {
	const { store, log, frozen = false, gate, losing = new Set() } = params
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
			if (property === 'getWriteOutcome' && losing.size > 0) {
				return async function outcomeLost() {
					throw lostConnection()
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
				if (losing.has(String(property))) throw lostConnection()
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

/** A refusal `STORE_CONNECTION_LOST`: what became of the call is not known. */
function lostConnection(): Error {
	return createDialecteError('STORE_CONNECTION_LOST', {
		detail: 'its host went while the call waited',
		meta: { reason: 'host-gone' },
	})
}

/** A record of the document `doc` holding `aA` with `value`, of tag `A` unless another is named. */
export function plainRecord(params: { id: string; value: string; tagName?: string }): AnyRawRecord {
	const { id, value, tagName = 'A' } = params
	return {
		id,
		tagName,
		namespace: { prefix: '', uri: 'urn:test' },
		attributes: [{ name: 'aA', value }],
		value: '',
		parent: null,
		children: [],
	}
}

/**
 * A store answering only `readVersioned`, from `records` (by id; lists in id order) and `version`, both taken when
 * the read is asked; a read held by `holdNextRead` answers that moment once released. Every read asked is logged.
 */
export function fakeVersionedStore(params: { records: AnyRawRecord[] }) {
	const records = new Map(params.records.map((record) => [record.id, record]))
	const version = { engineId: 'engine-1', count: 0 }
	const calls: VersionedRead[] = []
	const holds: Promise<void>[] = []

	function answerOf(read: VersionedRead): unknown {
		const all = [...records.values()].sort((left, right) => (left.id < right.id ? -1 : 1))
		switch (read.member) {
			case 'get':
				return copy(records.get(read.args[0]))
			case 'getMany':
				return read.args[0].map((id) => copy(records.get(id)))
			case 'getByTagNameInDocument':
				return all.filter((record) => record.tagName === read.args[0]).map(copy)
			case 'getByAttributes': {
				const [{ tagName, attributes }] = read.args
				return all
					.filter((record) => record.tagName === tagName)
					.filter((record) =>
						attributes.every((entry) =>
							record.attributes.some(
								(attribute) =>
									attribute.name === entry.name && entry.values.includes(attribute.value),
							),
						),
					)
					.map(copy)
			}
			case 'getByDocumentId':
				return all.map(copy)
		}
	}

	function copy(record: AnyRawRecord | undefined): AnyRawRecord | undefined {
		return record && cloneRecord({ record })
	}

	const store = {
		readVersioned: async function readVersioned(asked: { read: VersionedRead }) {
			calls.push(asked.read)
			const answer = { value: answerOf(asked.read), version: { ...version } }
			const hold = holds.shift()
			if (hold) await hold
			return answer
		},
	} as unknown as Store

	/** Hold the next read asked; it answers once the returned function is called. */
	function holdNextRead(): () => void {
		let release: () => void = () => {}
		holds.push(new Promise<void>((resolve) => (release = resolve)))
		return () => release()
	}

	return { store, records, version, calls, holdNextRead }
}

/** A query context over `store` with an open read scope, and the read epoch that scope follows. */
export function scopedContext(params: { store: Store }) {
	let epoch = 0
	const scope: ReadScope = {
		documentId: 'doc',
		epoch,
		version: undefined,
		records: new Map(),
		tagAnswers: new Map(),
		attributeAnswers: new Map(),
		documentAnswer: undefined,
		closed: false,
		epochOf: () => epoch,
	}
	const context = {
		kind: 'query',
		readScope: scope,
		store: params.store,
		documentId: 'doc',
		perf: NOOP_PERF,
	} as unknown as Context<AnyDialecteConfig>
	return {
		context,
		scope,
		moveEpoch: () => {
			epoch += 1
		},
	}
}
