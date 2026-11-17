import { countRecordsMoved } from '../get/record/count-records-moved'
import { STORE_READ_TALLY } from './read-scope.constants'

import { cloneRecord } from '@/store/in-memory/clone-record'

import type { Context } from '../../types'
import type {
	ReadScope,
	ScopedReadValue,
	StoreVersion,
	VersionedRead,
	VersionedStore,
} from './read-scope.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * One store read of the query layer, through the read scope of the call it runs in. Outside a scope (a transaction,
 * a query no Document wired, a store without `readVersioned`, a scope whose call settled) the store answers as it
 * always did. In a scope, what the call read before is answered again as copies; the rest is read with the store's
 * version and kept. A moved read epoch (a write the Project made or folded) or another version drops what the scope
 * held; an answer that comes back after the epoch moved is returned and not kept. Counts `core::store::<member>` and
 * its records moved per store call, `core::query::readScope.hit` per answer the scope gave.
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
 * The store read for what the scope lacks (a by-id list: its ids not held), kept unless the epoch moved meanwhile.
 * Another version than the scope's drops what it held first; a list answered partly from what was dropped is read
 * again whole, so one answer never mixes two versions.
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
	const asked = askedRead({ read, heldIds })
	context.perf.count(`core::store::${STORE_READ_TALLY[asked.member]}`)
	const answer = await store.readVersioned({ documentId: scope.documentId, read: asked })
	const value = answer.value
	tallyRecords({ context, read: asked, value })

	if (scope.closed || scope.epochOf() !== epoch) {
		return asked === read ? value : mergedById({ scope, read, asked, value })
	}
	if (!sameVersion({ held: scope.version, answered: answer.version })) {
		const mixed = heldIds.size > 0
		dropHeld({ scope })
		scope.version = answer.version
		if (mixed) return readAndKeep({ ...params, heldIds: new Set() })
	}
	keepAnswer({ scope, read: asked, value })
	return heldAnswer({ scope, read }).value
}

/** The read asked of the store: a by-id list without the ids held. */
function askedRead(params: { read: VersionedRead; heldIds: ReadonlySet<string> }): VersionedRead {
	const { read, heldIds } = params
	if (read.member !== 'getMany' || heldIds.size === 0) return read
	const [ids, documentId] = read.args
	const missing = [...new Set(ids.filter((id) => !heldIds.has(id)))]
	return { member: 'getMany', args: [missing, documentId] }
}

/** A by-id list answered from the held records and the store's answer for the rest, neither kept. */
function mergedById(params: {
	scope: ReadScope
	read: VersionedRead
	asked: VersionedRead
	value: ScopedReadValue
}): ScopedReadValue {
	const { scope, read, asked, value } = params
	if (read.member !== 'getMany' || asked.member !== 'getMany') return value
	const answered = new Map(asked.args[0].map((id, index) => [id, (value as AnyRawRecord[])[index]]))
	return read.args[0].map((id) =>
		answered.has(id) ? answered.get(id) : copyOf(scope.records.get(id)),
	)
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

function sameVersion(params: { held: StoreVersion | undefined; answered: StoreVersion }): boolean {
	const { held, answered } = params
	return held !== undefined && held.engineId === answered.engineId && held.count === answered.count
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
