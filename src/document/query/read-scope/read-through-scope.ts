import { countRecordsMoved } from '../get/record/count-records-moved'
import { STORE_READ_TALLY } from './read-scope.constants'

import { cloneRecord } from '@/store/in-memory/clone-record'

import type { Context } from '../../types'
import type {
	ReadScope,
	ScopedReadValue,
	StoreVersion,
	VersionedAnswer,
	VersionedRead,
	VersionedStore,
} from './read-scope.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * One store read of the query layer, through the read scope of the call it runs in. Outside a scope (a transaction,
 * a query no Document wired, a store without `readVersioned`, a scope whose call settled) the store answers as it
 * always did.
 *
 * In a scope, a call sees a snapshot of what it already read until a miss or a told change: what it read before is
 * answered again as copies, the rest is read with the store's version and kept. A told change (the read epoch moved:
 * a write the Project made or folded in) empties the scope; a miss answered at another version than the scope's
 * resets it to that answer (a newer count, or another engine), while an older answer is returned and not kept, as is
 * an answer that comes back after the epoch moved. A list read partly from the scope is never mixed with a later
 * moment: it is read again whole. Counts `core::store::<member>` and its records moved per store call,
 * `core::query::readScope.hit` per answer the scope gave.
 *
 * `findDescendants` keeps its own per-call record memo (`createRecordSource`) while a built-in store answers no
 * versioned reads (the local IndexedDB store opens no scope); it goes once every built-in store answers
 * `readVersioned`, this scope then answering the repeats.
 *
 * @internal the one reader behind every store read of the query layer
 */
export async function readThroughScope(params: {
	context: Context<AnyDialecteConfig>
	read: VersionedRead
}): Promise<ScopedReadValue> {
	const { context, read } = params
	const scope = context.kind === 'query' ? context.readScope : undefined
	const store = context.store as Partial<VersionedStore>
	if (!scope || scope.closed || typeof store.readVersioned !== 'function') {
		return readPlain({ context, read })
	}

	followEpoch({ scope })
	const held = heldAnswer({ scope, read })
	if (held.complete) {
		context.perf.count('core::query::readScope.hit')
		return held.value
	}
	return readAndKeep({
		context,
		scope,
		store: store as VersionedStore,
		read,
		heldIds: held.heldIds,
	})
}

/** The store's member called as it is, counted. */
async function readPlain(params: {
	context: Context<AnyDialecteConfig>
	read: VersionedRead
}): Promise<ScopedReadValue> {
	const { context, read } = params
	const member = context.store[read.member] as (...args: unknown[]) => Promise<ScopedReadValue>
	context.perf.count(`core::store::${STORE_READ_TALLY[read.member]}`)
	const value = await member.apply(context.store, read.args)
	tallyRecords({ context, read, value })
	return value
}

/** The scope emptied when the document's read epoch moved since it was filled. */
// dialecte-allow argument-mutation: the scope is the call's own state, refreshed as the epoch moves
function followEpoch(params: { scope: ReadScope }): void {
	const { scope } = params
	const epoch = scope.epochOf()
	if (epoch === scope.epoch) return
	dropHeld({ scope })
	scope.epoch = epoch
	scope.version = undefined
}

/** What the scope holds of `read`: whole (as copies), or for a by-id list the ids it holds. */
function heldAnswer(params: { scope: ReadScope; read: VersionedRead }): {
	complete: boolean
	value?: ScopedReadValue
	heldIds: ReadonlySet<string>
} {
	const { scope, read } = params
	const none = { complete: false, heldIds: new Set<string>() }
	switch (read.member) {
		case 'get': {
			const [id] = read.args
			if (!scope.records.has(id)) return none
			return { complete: true, value: copyOf(scope.records.get(id)), heldIds: none.heldIds }
		}
		case 'getMany': {
			const [ids] = read.args
			const heldIds = new Set(ids.filter((id) => scope.records.has(id)))
			if (heldIds.size < new Set(ids).size) return { complete: false, heldIds }
			return { complete: true, value: ids.map((id) => copyOf(scope.records.get(id))), heldIds }
		}
		case 'getByTagNameInDocument': {
			const [tagName] = read.args
			const ids = scope.tagAnswers.get(tagName) ?? idsOfTagInDocument({ scope, tagName })
			return ids ? listAnswer({ scope, ids }) : none
		}
		case 'getByAttributes': {
			const ids = scope.attributeAnswers.get(attributeKey({ read }))
			return ids ? listAnswer({ scope, ids }) : none
		}
		case 'getByDocumentId':
			return scope.documentAnswer ? listAnswer({ scope, ids: scope.documentAnswer }) : none
	}
}

/** The ids of a tag in the document the scope read whole (both answers are in id order). */
function idsOfTagInDocument(params: { scope: ReadScope; tagName: string }): string[] | undefined {
	const { scope, tagName } = params
	return scope.documentAnswer?.filter((id) => scope.records.get(id)?.tagName === tagName)
}

function listAnswer(params: { scope: ReadScope; ids: string[] }): {
	complete: boolean
	value: AnyRawRecord[]
	heldIds: ReadonlySet<string>
} {
	const { scope, ids } = params
	const value = ids.map((id) => copyOf(scope.records.get(id)) as AnyRawRecord)
	return { complete: true, value, heldIds: new Set() }
}

/**
 * The store read for what the scope lacks (a by-id list: its ids not held), kept when it is of the scope's moment:
 * - the epoch moved or the call settled while it was read: returned, not kept (a list answered partly from the scope
 *   is read again whole, so it never holds records the move emptied);
 * - an older version than the scope's (the same engine, a lower count): returned, not kept (a partial list read again
 *   whole);
 * - a newer version, or another engine's: what the scope held is dropped and the answer kept (a partial list read
 *   again whole first);
 * - the scope reset by another read meanwhile, to this answer's version: a partial list read again whole.
 */
// dialecte-allow argument-mutation: the scope is the call's own state, filled by its reads
async function readAndKeep(params: {
	context: Context<AnyDialecteConfig>
	scope: ReadScope
	store: VersionedStore
	read: VersionedRead
	heldIds: ReadonlySet<string>
}): Promise<ScopedReadValue> {
	const { context, scope, store, read, heldIds } = params
	const epoch = scope.epoch
	const versionAtStart = scope.version
	const asked = askedRead({ read, heldIds })
	const partial = asked !== read
	const answer = await askStore({ context, scope, store, read: asked })

	const moved = scope.closed || scope.epochOf() !== epoch
	const order = versionOrder({ held: scope.version, answered: answer.version })
	if (moved || order === 'older') {
		if (!partial) return answer.value
		const whole = await askStore({ context, scope, store, read })
		return whole.value
	}
	if (order === 'newer') {
		dropHeld({ scope })
		scope.version = answer.version
		if (partial) return readAndKeep({ ...params, heldIds: new Set() })
	} else if (partial && scope.version !== versionAtStart) {
		return readAndKeep({ ...params, heldIds: new Set() })
	}
	keepAnswer({ scope, read: asked, value: answer.value })
	return heldAnswer({ scope, read }).value
}

/** One versioned read of the store, counted. */
async function askStore(params: {
	context: Context<AnyDialecteConfig>
	scope: ReadScope
	store: VersionedStore
	read: VersionedRead
}): Promise<VersionedAnswer> {
	const { context, scope, store, read } = params
	context.perf.count(`core::store::${STORE_READ_TALLY[read.member]}`)
	const answer = await store.readVersioned({ documentId: scope.documentId, read })
	tallyRecords({ context, read, value: answer.value })
	return answer
}

/** The read asked of the store: a by-id list without the ids held. */
function askedRead(params: { read: VersionedRead; heldIds: ReadonlySet<string> }): VersionedRead {
	const { read, heldIds } = params
	if (read.member !== 'getMany' || heldIds.size === 0) return read
	const [ids, documentId] = read.args
	const missing = [...new Set(ids.filter((id) => !heldIds.has(id)))]
	return { member: 'getMany', args: [missing, documentId] }
}

/** The store's answer held by the scope, by id and under the read that answered it. */
// dialecte-allow argument-mutation: the scope is the call's own state, filled by its reads
function keepAnswer(params: {
	scope: ReadScope
	read: VersionedRead
	value: ScopedReadValue
}): void {
	const { scope, read, value } = params
	if (read.member === 'get') {
		scope.records.set(read.args[0], value as AnyRawRecord | undefined)
		return
	}
	if (read.member === 'getMany') {
		const records = value as (AnyRawRecord | undefined)[]
		read.args[0].forEach((id, index) => scope.records.set(id, records[index]))
		return
	}
	const records = value as AnyRawRecord[]
	for (const record of records) scope.records.set(record.id, record)
	const ids = records.map((record) => record.id)
	if (read.member === 'getByTagNameInDocument') scope.tagAnswers.set(read.args[0], ids)
	else if (read.member === 'getByAttributes')
		scope.attributeAnswers.set(attributeKey({ read }), ids)
	else scope.documentAnswer = ids
}

// dialecte-allow argument-mutation: the scope is the call's own state, emptied when what it held went stale
function dropHeld(params: { scope: ReadScope }): void {
	const { scope } = params
	scope.records.clear()
	scope.tagAnswers.clear()
	scope.attributeAnswers.clear()
	scope.documentAnswer = undefined
}

function attributeKey(params: {
	read: Extract<VersionedRead, { member: 'getByAttributes' }>
}): string {
	const [{ tagName, attributes }] = params.read.args
	return JSON.stringify([tagName, attributes])
}

/**
 * How an answer's version stands to the scope's: the same moment, newer (a higher count of the same engine, any
 * count of another engine, or the scope has none yet) or older (a lower count of the same engine).
 */
function versionOrder(params: {
	held: StoreVersion | undefined
	answered: StoreVersion
}): 'same' | 'newer' | 'older' {
	const { held, answered } = params
	if (held === undefined || held.engineId !== answered.engineId) return 'newer'
	if (answered.count === held.count) return 'same'
	return answered.count > held.count ? 'newer' : 'older'
}

/** A record of the scope as a caller gets it: its own copy, so changing it changes neither the scope nor another answer. */
function copyOf(record: AnyRawRecord | undefined): AnyRawRecord | undefined {
	return record && cloneRecord({ record })
}

function tallyRecords(params: {
	context: Context<AnyDialecteConfig>
	read: VersionedRead
	value: ScopedReadValue
}): void {
	const { context, read, value } = params
	const records = Array.isArray(value) ? value : [value]
	countRecordsMoved({ perf: context.perf, member: STORE_READ_TALLY[read.member], records })
}
