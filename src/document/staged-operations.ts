import type { StagedAttributeIndex, StagedOperations } from './types'
import type { AnyDialecteConfig, AnyRawRecord, Operation } from '@/types'

/**
 * Fresh empty staged-operations container (ordered log + derived by-id index).
 *
 * @internal the empty container a transaction stages its writes in; created by Document
 */
export function createStagedOperations<
	GenericConfig extends AnyDialecteConfig,
>(): StagedOperations<GenericConfig> {
	return { log: [], byId: new Map(), byAttribute: new Map(), appended: new Map() }
}

/**
 * Append one operation to the staged writes and keep their indexes in step: the latest operation of its id, the
 * attribute values of the record it leaves staged (those of the id's previous operation dropped), and the id's place
 * after a tag's stored records.
 *
 * @internal the one writer of a transaction's staged operations
 */
// dialecte-allow argument-mutation: a transaction's staged operations are its mutable log, written here only
export function recordStagedOperation<GenericConfig extends AnyDialecteConfig>(params: {
	stagedOperations: StagedOperations<GenericConfig>
	operation: Operation<GenericConfig>
}): void {
	const { stagedOperations, operation } = params
	const { log, byId, byAttribute, appended } = stagedOperations
	const id = operation.status === 'deleted' ? operation.oldRecord.id : operation.newRecord.id
	const previous = byId.get(id)
	if (previous && previous.status !== 'deleted') {
		indexAttributeValues({ record: previous.newRecord, index: byAttribute, act: 'remove' })
	}
	if (operation.status === 'deleted') appended.delete(id)
	else {
		indexAttributeValues({ record: operation.newRecord, index: byAttribute, act: 'add' })
		// as replaying the log on a tag read: a new id, or one written again after its delete, goes to the end
		const placed =
			previous === undefined ? operation.status === 'created' : previous.status === 'deleted'
		if (placed && !appended.has(id)) appended.set(id, log.length)
	}
	log.push(operation)
	byId.set(id, operation)
}

/** Add or remove each attribute value of a staged record under its tag, name and value; an emptied entry goes. */
// dialecte-allow argument-mutation: the staged index is written by recordStagedOperation only, through this
function indexAttributeValues(params: {
	record: AnyRawRecord
	index: StagedAttributeIndex
	act: 'add' | 'remove'
}): void {
	const { record, index, act } = params
	const byName = index.get(record.tagName) ?? new Map<string, Map<string, Set<string>>>()
	index.set(record.tagName, byName)
	for (const { name, value } of record.attributes) {
		const byValue = byName.get(name) ?? new Map<string, Set<string>>()
		byName.set(name, byValue)
		const ids = byValue.get(value) ?? new Set<string>()
		byValue.set(value, ids)
		if (act === 'add') ids.add(record.id)
		else ids.delete(record.id)
		if (ids.size === 0) byValue.delete(value)
		if (byValue.size === 0) byName.delete(name)
	}
	if (byName.size === 0) index.delete(record.tagName)
}
