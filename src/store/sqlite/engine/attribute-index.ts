import {
	ATTRIBUTE_BUILD_ROWS_PER_SLICE,
	ATTRIBUTE_INDEX_PREFIX,
	ATTRIBUTE_PAIR_STATE,
	ITEM_NAME,
	ITEM_VALUE,
} from './attribute-index.constants'
import { RECORD_COLUMN_LIST } from './engine.constants'
import { recordOf } from './records'

import { compareById } from '@/store/compare-by-id'
import { TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type {
	AttributeIndexTables,
	AttributePairState,
	IndexKeysSource,
} from './attribute-index.types'
import type { AttributeLookup } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm'

/** The attribute index of the record table numbered `seq`: its tables and its triggers' prefix. */
export function attributeIndexTablesOf(params: { seq: number }): AttributeIndexTables {
	const { seq } = params
	return {
		records: `${TABLE_RECORD_PREFIX}${seq}`,
		names: `${ATTRIBUTE_INDEX_PREFIX.names}${seq}`,
		rows: `${ATTRIBUTE_INDEX_PREFIX.rows}${seq}`,
		keys: `${ATTRIBUTE_INDEX_PREFIX.keys}${seq}`,
		triggers: `${ATTRIBUTE_INDEX_PREFIX.triggers}${seq}_`,
	}
}

/**
 * The state of each of these attribute names paired with the tag in the index (none for a pair never registered,
 * nor for a document without an index yet).
 */
export function readPairStates(params: {
	db: Database
	tables: AttributeIndexTables
	tagName: string
	names: readonly string[]
}): Map<string, AttributePairState> {
	const { db, tables, tagName, names } = params
	const held = db.selectValue('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?', [
		'table',
		tables.keys,
	])
	if (held === undefined) return new Map()
	const rows = db.selectArrays(
		`SELECT n.text, k.state FROM ${tables.keys} k ` +
			`JOIN ${tables.names} t ON t.nid = k.tagId JOIN ${tables.names} n ON n.nid = k.nameId ` +
			'WHERE t.text = ? AND n.text IN (SELECT value FROM json_each(?))',
		[tagName, JSON.stringify(names)],
	)
	return new Map(rows.map(([name, state]) => [String(name), Number(state) as AttributePairState]))
}

/**
 * The records of the tag holding, for every entry, an attribute of its name with one of its values, read from the
 * index (every pair `ready`): one row per record, in id order.
 */
export function readIndexedRecords(params: {
	db: Database
	tables: AttributeIndexTables
	tagName: string
	attributes: AttributeLookup['attributes']
}): AnyRawRecord[] {
	const { db, tables, tagName, attributes } = params
	const nameId = `(SELECT nid FROM ${tables.names} WHERE text = ?)`
	const matches = attributes.map(
		() =>
			`SELECT recRow FROM ${tables.rows} WHERE tagId = ${nameId} AND nameId = ${nameId} ` +
			'AND value IN (SELECT value FROM json_each(?))',
	)
	const bind: SqlValue[] = [tagName]
	for (const { name, values } of attributes) bind.push(tagName, name, JSON.stringify(values))
	return db
		.selectArrays(
			`SELECT ${RECORD_COLUMN_LIST} FROM ${tables.records} WHERE tagName = ? AND rowid IN (${matches.join(' INTERSECT ')})`,
			bind,
		)
		.map((row) => recordOf({ row }))
		.sort(compareById)
}

/**
 * The same records as `readIndexedRecords`, found by reading each record of the tag's attributes in SQL: what a pair
 * not `ready` is answered with. Only the matching records leave SQLite.
 */
export function readFilteredRecords(params: {
	db: Database
	table: string
	tagName: string
	attributes: AttributeLookup['attributes']
}): AnyRawRecord[] {
	const { db, table, tagName, attributes } = params
	const items = itemsOf({ attributes: 'r.attributes' })
	const matches = attributes.map(
		() =>
			`EXISTS (SELECT 1 FROM ${items} WHERE a.type = 'object' AND ${ITEM_NAME} = ? ` +
			`AND ${ITEM_VALUE} IN (SELECT value FROM json_each(?)))`,
	)
	const bind: SqlValue[] = [tagName]
	for (const { name, values } of attributes) bind.push(name, JSON.stringify(values))
	return db
		.selectArrays(
			`SELECT ${RECORD_COLUMN_LIST} FROM ${table} r WHERE r.tagName = ? AND ${matches.join(' AND ')}`,
			bind,
		)
		.map((row) => recordOf({ row }))
		.sort(compareById)
}

/**
 * The pair registered in the index, in the caller's transaction: the index's tables and triggers made when the
 * document has none, the names kept, the pair `building` unless it was registered already. From then on every
 * write keeps the pair's rows of the records it touches. Answers the pair's state.
 */
export function registerAttributePair(params: {
	db: Database
	tables: AttributeIndexTables
	tagName: string
	name: string
}): AttributePairState {
	const { db, tables, tagName, name } = params
	createIndexTables({ db, tables })
	db.exec({
		sql: `INSERT OR IGNORE INTO ${tables.names} (text) VALUES (?), (?)`,
		bind: [tagName, name],
	})
	db.exec({
		sql:
			`INSERT OR IGNORE INTO ${tables.keys} (tagId, nameId, state) ` +
			`SELECT t.nid, n.nid, ? FROM ${tables.names} t, ${tables.names} n WHERE t.text = ? AND n.text = ?`,
		bind: [ATTRIBUTE_PAIR_STATE.building, tagName, name],
	})
	return readPairStates({ db, tables, tagName, names: [name] }).get(name)!
}

/**
 * One slice of a pair's build, in the caller's transaction: the rows of the next records of the tag after the
 * record row `afterRow` (in row order, `ATTRIBUTE_BUILD_ROWS_PER_SLICE` at most). Answers the last record row
 * read, none once the tag has no record after `afterRow`.
 */
export function buildAttributeSlice(params: {
	db: Database
	tables: AttributeIndexTables
	tagName: string
	name: string
	afterRow: number
}): number | undefined {
	const { db, tables, tagName, name, afterRow } = params
	const last = db.selectValue(
		`SELECT max(rowid) FROM (SELECT rowid FROM ${tables.records} WHERE tagName = ? AND rowid > ? ` +
			'ORDER BY rowid LIMIT ?)',
		[tagName, afterRow, ATTRIBUTE_BUILD_ROWS_PER_SLICE],
	)
	if (last === null || last === undefined) return undefined
	const keys = keysOf({
		tables,
		source: {
			from: `${tables.records} o, `,
			tag: 'o.tagName',
			attributes: 'o.attributes',
			row: 'o.rowid',
			where: 'AND o.tagName = ? AND o.rowid > ? AND o.rowid <= ? AND n.text = ?',
		},
	})
	db.exec({
		sql: `INSERT OR IGNORE INTO ${tables.rows} (tagId, nameId, value, recRow) ${keys}`,
		bind: [tagName, afterRow, Number(last), name],
	})
	return Number(last)
}

/** The pair `ready` once its last slice is in, in the caller's transaction; whether it was still `building`. */
export function markAttributePairReady(params: {
	db: Database
	tables: AttributeIndexTables
	tagName: string
	name: string
}): boolean {
	const { db, tables, tagName, name } = params
	const nameId = `(SELECT nid FROM ${tables.names} WHERE text = ?)`
	db.exec({
		sql: `UPDATE ${tables.keys} SET state = ? WHERE tagId = ${nameId} AND nameId = ${nameId} AND state = ?`,
		bind: [ATTRIBUTE_PAIR_STATE.ready, tagName, name, ATTRIBUTE_PAIR_STATE.building],
	})
	return db.changes() === 1
}

/**
 * The attribute index of the record table numbered `seq` dropped, in the caller's transaction, after its record
 * table (which takes the triggers with it): what a removal leaves of it is nothing.
 */
export function dropAttributeIndex(params: { db: Database; seq: number }): void {
	const { db, seq } = params
	const tables = attributeIndexTablesOf({ seq })
	db.exec(
		`DROP TABLE IF EXISTS ${tables.rows}; DROP TABLE IF EXISTS ${tables.keys}; ` +
			`DROP TABLE IF EXISTS ${tables.names};`,
	)
}

/** The items of an attributes column as `a`: none when the column is not JSON (a trigger never refuses a write). */
function itemsOf(params: { attributes: string }): string {
	const { attributes } = params
	return `json_each(CASE WHEN json_valid(${attributes}) THEN ${attributes} ELSE '[]' END) a`
}

/**
 * The index rows of the record row `source` describes, for every registered pair of its tag: one per attribute of
 * the pair's name holding a value (an item that is not an object, or holds no value, gives none).
 */
function keysOf(params: { tables: AttributeIndexTables; source: IndexKeysSource }): string {
	const { tables, source } = params
	return (
		`SELECT k.tagId, k.nameId, ${ITEM_VALUE}, ${source.row} ` +
		`FROM ${source.from ?? ''}${tables.names} t JOIN ${tables.keys} k ON k.tagId = t.nid ` +
		`JOIN ${tables.names} n ON n.nid = k.nameId JOIN ${itemsOf({ attributes: source.attributes })} ` +
		`WHERE t.text = ${source.tag} AND a.type = 'object' AND ${ITEM_NAME} = n.text ` +
		`AND ${ITEM_VALUE} IS NOT NULL ${source.where ?? ''}`
	)
}

/** Whether a record row's tag has a registered pair, SQL. */
function registeredTag(params: { tables: AttributeIndexTables; tag: string }): string {
	const { tables, tag } = params
	return (
		`EXISTS (SELECT 1 FROM ${tables.names} t JOIN ${tables.keys} k ON k.tagId = t.nid ` +
		`WHERE t.text = ${tag})`
	)
}

/** The rows of `keys` gone from the index. */
function deleteKeys(params: { tables: AttributeIndexTables; keys: string }): string {
	const { tables, keys } = params
	return `DELETE FROM ${tables.rows} WHERE (tagId, nameId, value, recRow) IN (${keys});`
}

/** The rows of `keys` added to the index, a row held already left as it is. */
function insertKeys(params: { tables: AttributeIndexTables; keys: string }): string {
	const { tables, keys } = params
	return `INSERT OR IGNORE INTO ${tables.rows} (tagId, nameId, value, recRow) ${keys};`
}

/**
 * The index's tables and triggers, when the document has none yet. The triggers are pure SQL and refuse nothing: a
 * replaced row's rows go before its new row is written (`INSERT OR REPLACE` deletes it without a delete trigger
 * while `recursive_triggers` is off), a new row's rows are added, a deleted row's removed, an update changing the
 * attributes or the tag moves them.
 */
function createIndexTables(params: { db: Database; tables: AttributeIndexTables }): void {
	const { db, tables } = params
	const { records, triggers } = tables
	const newRow = keysOf({
		tables,
		source: { tag: 'NEW.tagName', attributes: 'NEW.attributes', row: 'NEW.rowid' },
	})
	const oldRow = keysOf({
		tables,
		source: { tag: 'OLD.tagName', attributes: 'OLD.attributes', row: 'OLD.rowid' },
	})
	const replacedRow = keysOf({
		tables,
		source: {
			from: `${records} o, `,
			tag: 'o.tagName',
			attributes: 'o.attributes',
			row: 'o.rowid',
			where: 'AND o.id = NEW.id',
		},
	})
	const newTag = registeredTag({ tables, tag: 'NEW.tagName' })
	const oldTag = registeredTag({ tables, tag: 'OLD.tagName' })
	db.exec(
		`CREATE TABLE IF NOT EXISTS ${tables.names} (nid INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE);` +
			`CREATE TABLE IF NOT EXISTS ${tables.rows} (tagId INTEGER NOT NULL, nameId INTEGER NOT NULL, ` +
			'value TEXT NOT NULL, recRow INTEGER NOT NULL, PRIMARY KEY (tagId, nameId, value, recRow)) WITHOUT ROWID;' +
			`CREATE TABLE IF NOT EXISTS ${tables.keys} (tagId INTEGER NOT NULL, nameId INTEGER NOT NULL, ` +
			'state INTEGER NOT NULL, PRIMARY KEY (tagId, nameId)) WITHOUT ROWID;' +
			`CREATE TRIGGER IF NOT EXISTS ${triggers}beforeInsert BEFORE INSERT ON ${records} ` +
			`WHEN EXISTS (SELECT 1 FROM ${records} o WHERE o.id = NEW.id AND ${registeredTag({ tables, tag: 'o.tagName' })}) ` +
			`BEGIN ${deleteKeys({ tables, keys: replacedRow })} END;` +
			`CREATE TRIGGER IF NOT EXISTS ${triggers}afterInsert AFTER INSERT ON ${records} WHEN ${newTag} ` +
			`BEGIN ${insertKeys({ tables, keys: newRow })} END;` +
			`CREATE TRIGGER IF NOT EXISTS ${triggers}afterDelete AFTER DELETE ON ${records} WHEN ${oldTag} ` +
			`BEGIN ${deleteKeys({ tables, keys: oldRow })} END;` +
			`CREATE TRIGGER IF NOT EXISTS ${triggers}afterUpdate AFTER UPDATE OF attributes, tagName ON ${records} ` +
			'WHEN (OLD.attributes IS NOT NEW.attributes OR OLD.tagName IS NOT NEW.tagName) ' +
			`AND (${oldTag} OR ${newTag}) ` +
			`BEGIN ${deleteKeys({ tables, keys: oldRow })} ${insertKeys({ tables, keys: newRow })} END;`,
	)
}
