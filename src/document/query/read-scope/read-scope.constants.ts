import type { StoreReadMember } from '../get/record/count-records-moved.types'
import type { ReadScope, ReadScopeWiring, VersionedReadMember } from './read-scope.types'

/** The dev perf tally of each store read member: `core::store::<tally>` and `core::store::records.<tally>`. */
export const STORE_READ_TALLY: Record<VersionedReadMember, StoreReadMember> = {
	get: 'get',
	getMany: 'getMany',
	getByTagNameInDocument: 'getByTagName',
	getByAttributes: 'getByAttributes',
	getByDocumentId: 'getByDocumentId',
}

/**
 * The public read methods of `Query` that open a read scope when called on a query that has none: every method whose
 * reads go through the store. `getDocumentInfo` reads the registry, not the document's records.
 */
export const SCOPED_QUERY_METHODS = [
	'getRoot',
	'getRecord',
	'getDefinition',
	'getRecords',
	'getChild',
	'getChildren',
	'getChildrenOfEach',
	'getRecordsByTagName',
	'findDescendants',
	'findDescendantsOfEach',
	'findAncestors',
	'findAncestorsOfEach',
	'getTree',
	'getSnapshot',
	'getAttribute',
	'getAttributes',
	'findByAttributes',
] as const

/** The changes another realm tells of a document's records: each one empties every read scope of the document. */
export const READ_SCOPE_VOIDING_MESSAGES: ReadonlySet<string> = new Set([
	'commit',
	'init-empty-document',
	'document-removed',
	'document-imported',
])

/** The wiring each Query a Document built carries, and each scoped child of it. */
export const READ_SCOPE_WIRINGS = new WeakMap<object, ReadScopeWiring>()

/** The scope each scoped child runs in. */
export const READ_SCOPES = new WeakMap<object, ReadScope>()
