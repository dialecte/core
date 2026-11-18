/**
 * The attribute index of a document's record table `xel_<seq>`, numbered as it: the names of tags and attributes
 * (`xname_<seq>`), the index rows (`xattr_<seq>`), the (tag, attribute) pairs it keeps and their state
 * (`xkeys_<seq>`), and its triggers (`xatr_<seq>_<event>`). Dropped with the document.
 */
export const ATTRIBUTE_INDEX_PREFIX = {
	names: 'xname_',
	rows: 'xattr_',
	keys: 'xkeys_',
	triggers: 'xatr_',
} as const

/**
 * The name of a table or a trigger of an attribute index, its record table's number captured: `xname_3`, `xattr_3`,
 * `xkeys_3`, `xatr_3_afterInsert`.
 */
export const ATTRIBUTE_INDEX_NAME = new RegExp(
	`^(?:${Object.values(ATTRIBUTE_INDEX_PREFIX).join('|')})(\\d+)(?:_|$)`,
)

/**
 * Where a pair of the index stands: `building` (registered, its triggers keep the rows of every record a write
 * touches, the records written before are being added in slices), `ready` (every record of the tag has its rows: a
 * lookup reads them). A lookup of a pair not `ready` filters the tag instead.
 */
export const ATTRIBUTE_PAIR_STATE = {
	building: 0,
	ready: 1,
} as const

/**
 * Records of the tag one build slice adds to a pair, in one short transaction: a pair of a 90,000-record tag builds
 * in 45 slices, the calls waiting run between them.
 */
export const ATTRIBUTE_BUILD_ROWS_PER_SLICE = 2000

/** The triggers of a record table that keep its index, each named `xatr_<seq>_<trigger>`. */
export const ATTRIBUTE_INDEX_TRIGGERS = [
	'beforeInsert',
	'afterInsert',
	'afterDelete',
	'afterUpdate',
] as const

/**
 * An attributes item's name and value, as SQL over `json_each(...) a`: none for an item that is not an object (the
 * `CASE` keeps `->>` from reading an item that is not JSON text). A value that is not a JSON string (a number, a
 * boolean) becomes text in the index's TEXT column (`1` -> `'1'`), where the filter compares it as SQL reads it; core
 * writes every attribute value as a string, so the two never differ on what it stores.
 */
export const ITEM_NAME = "(CASE WHEN a.type = 'object' THEN a.value->>'name' END)"
export const ITEM_VALUE = "(CASE WHEN a.type = 'object' THEN a.value->>'value' END)"
