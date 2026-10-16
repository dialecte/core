import { getRecord, getRecordsByTagName, isTransactionContext, loadLiveRecords } from '@/document'
import { throwDialecteError } from '@/errors'

import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * Store reads a call may issue before it asks the store how big the document is. Asking costs a
 * count, which IndexedDB answers by iterating (about 50 ms for 90,000 records), so a call this
 * small never asks: on IndexedDB 128 reads cost about 8 ms, the count of a 15,000-record document.
 * It is also the floor of the switch: a document read is never due before this many reads.
 */
export const READS_BEFORE_SIZING = 128

/**
 * What one record of a whole-document read costs, in by-id reads: the switch from climbing to
 * reading the document once is due after `count × this` store reads.
 *
 * Measured on IndexedDB (Dexie, Chromium) on the 5 and 10 MB stress fixtures (92,000 and 184,000
 * records): one `get` 0.065 ms, one `getByDocumentId` 351 and 664 ms, so a record of the whole
 * read costs 1/17.4 and 1/17.7 of a `get`. The in-memory store reads too fast for it to matter.
 */
export const DOCUMENT_READ_COST_PER_RECORD = 1 / 17

type AnyTracked<GenericConfig extends AnyDialecteConfig> = TrackedRecord<
	GenericConfig,
	ElementsOf<GenericConfig>
>

type RefById<GenericConfig extends AnyDialecteConfig> = Ref<
	GenericConfig,
	ElementsOf<GenericConfig>
> & { id: string }

/**
 * The records of one `findDescendants` call. Reads go to the store, each record once (a
 * per-call memo), until the call has issued more store reads (by id or by tag name) than one
 * whole-document read is worth for this document; from then on every record comes from one
 * in-memory map of the document (staged operations overlaid), and no store read is issued any
 * more. A record served by the staged operations or the transaction cache is not a store read.
 *
 * A ref whose tag name differs from the record stored under its id throws
 * `ELEMENT_TAGNAME_MISMATCH`, as `getRecord` does, whichever way the record is served.
 */
export type RecordSource<GenericConfig extends AnyDialecteConfig> = {
	/** One record by ref. Staged operations come first, as with `getRecord`. */
	get(
		ref: Ref<GenericConfig, ElementsOf<GenericConfig>>,
	): Promise<AnyTracked<GenericConfig> | undefined>
	/** Several records by ref, in the order given; a missing record yields `undefined`. */
	getMany(
		refs: Ref<GenericConfig, ElementsOf<GenericConfig>>[],
	): Promise<(AnyTracked<GenericConfig> | undefined)[]>
	/** Every live record of a tag name. */
	byTag(tagName: ElementsOf<GenericConfig>): Promise<AnyTracked<GenericConfig>[]>
}

export function createRecordSource<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
}): RecordSource<GenericConfig> {
	const { context } = params

	const memo = new Map<string, AnyTracked<GenericConfig> | undefined>()
	let loaded: Map<string, AnyTracked<GenericConfig>> | undefined
	/** The loaded document grouped by tag name (see `loadedOfTag`). */
	let loadedByTag: Map<string, AnyTracked<GenericConfig>[]> | undefined
	let storeReads = 0
	let readsWorthOneDocumentRead: number | undefined

	/** Whether reading `id` goes to the store, rather than to the staged operations or the cache. */
	function reachesStore(id: string): boolean {
		if (context.stagedOperations.byId.has(id)) return false
		return !(isTransactionContext(context) && context.recordCache.has(id))
	}

	/**
	 * The in-memory document, read now if `pendingReads` more store reads would pass the
	 * break-even; `undefined` while climbing is still the cheaper way.
	 */
	async function loadIfDue(
		pendingReads: number,
	): Promise<Map<string, AnyTracked<GenericConfig>> | undefined> {
		if (loaded) return loaded
		if (pendingReads === 0 || storeReads + pendingReads <= READS_BEFORE_SIZING) return undefined
		if (readsWorthOneDocumentRead === undefined) {
			context.perf.count('core::store::count')
			const size = await context.store.count(context.documentId)
			readsWorthOneDocumentRead = Math.max(
				READS_BEFORE_SIZING,
				Math.ceil(size * DOCUMENT_READ_COST_PER_RECORD),
			)
		}
		if (storeReads + pendingReads <= readsWorthOneDocumentRead) return undefined
		loaded = await loadLiveRecords(context)
		return loaded
	}

	/** `record` as the answer for `ref`, refusing one stored under that id with another tag name. */
	function checkedTag(
		ref: RefById<GenericConfig>,
		record: AnyTracked<GenericConfig> | undefined,
	): AnyTracked<GenericConfig> | undefined {
		if (record && record.tagName !== ref.tagName) {
			throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
				detail: `Expected tagName '${ref.tagName}', got '${record.tagName}' for id '${ref.id}'`,
				ref,
			})
		}
		return record
	}

	async function get(
		ref: Ref<GenericConfig, ElementsOf<GenericConfig>>,
	): Promise<AnyTracked<GenericConfig> | undefined> {
		// A singleton ref (no id) is resolved by `getRecord` itself: staged records first.
		if (ref.id === undefined) return getRecord({ context, ref })
		const byId = ref as RefById<GenericConfig>
		if (loaded) return checkedTag(byId, loaded.get(byId.id))
		if (memo.has(byId.id)) return checkedTag(byId, memo.get(byId.id))
		const toStore = reachesStore(byId.id)
		const document = toStore ? await loadIfDue(1) : undefined
		if (document) return checkedTag(byId, document.get(byId.id))
		if (toStore) storeReads++
		const record = await getRecord({ context, ref: byId })
		memo.set(byId.id, record)
		return record
	}

	async function getMany(
		refs: Ref<GenericConfig, ElementsOf<GenericConfig>>[],
	): Promise<(AnyTracked<GenericConfig> | undefined)[]> {
		if (!loaded) {
			const missing = new Map<string, RefById<GenericConfig>>()
			for (const ref of refs) {
				if (ref.id === undefined || memo.has(ref.id) || missing.has(ref.id)) continue
				missing.set(ref.id, ref as RefById<GenericConfig>)
			}
			const toStore = [...missing.keys()].filter(reachesStore).length
			if (!(await loadIfDue(toStore))) {
				storeReads += toStore
				const unread = [...missing.values()]
				const records = await Promise.all(unread.map((ref) => getRecord({ context, ref })))
				unread.forEach((ref, index) => memo.set(ref.id, records[index]))
			}
		}
		return Promise.all(refs.map((ref) => get(ref)))
	}

	/** The loaded document grouped by tag name, built once on first use. */
	function loadedOfTag(
		document: Map<string, AnyTracked<GenericConfig>>,
		tagName: ElementsOf<GenericConfig>,
	): AnyTracked<GenericConfig>[] {
		if (!loadedByTag) {
			loadedByTag = new Map()
			for (const record of document.values()) {
				const group = loadedByTag.get(record.tagName)
				if (group) group.push(record)
				else loadedByTag.set(record.tagName, [record])
			}
		}
		return loadedByTag.get(tagName) ?? []
	}

	async function byTag(tagName: ElementsOf<GenericConfig>): Promise<AnyTracked<GenericConfig>[]> {
		// A tag read is a store round trip like a by-id read: it counts toward the break-even.
		const document = loaded ?? (await loadIfDue(1))
		if (document) return loadedOfTag(document, tagName)
		storeReads++
		return getRecordsByTagName({ context, tagName })
	}

	return { get, getMany, byTag }
}
