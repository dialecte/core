import { attributeIndexTablesOf } from './attribute-index'
import { ATTRIBUTE_PAIR_STATE } from './attribute-index.constants'

import { TABLE_DOCUMENTS } from '@/store/store.constants'

import type { AnyAttribute } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** An index row as a case compares it: tag, attribute name, value, and the id of the record row it points at. */
export type IndexRow = [string, string, string, string]

/** The record table number of a registered document. */
export function seqOf(params: { db: Database; documentId: string }): number {
	const { db, documentId } = params
	return Number(db.selectValue(`SELECT seq FROM ${TABLE_DOCUMENTS} WHERE id = ?`, [documentId]))
}

/** The state of each registered pair of the document's index, as `tag.name` -> `building` | `ready`. */
export function pairStatesOf(params: { db: Database; seq: number }): Record<string, string> {
	const { db, seq } = params
	const tables = attributeIndexTablesOf({ seq })
	if (!hasTable({ db, table: tables.keys })) return {}
	const rows = db.selectArrays(
		`SELECT t.text, n.text, k.state FROM ${tables.keys} k JOIN ${tables.names} t ON t.nid = k.tagId ` +
			`JOIN ${tables.names} n ON n.nid = k.nameId`,
	)
	return Object.fromEntries(
		rows.map(([tag, name, state]) => [
			`${String(tag)}.${String(name)}`,
			state === ATTRIBUTE_PAIR_STATE.ready ? 'ready' : 'building',
		]),
	)
}

/**
 * Every registered pair of the document's index `ready`, and at least `pairs` of them: a lookup builds its pairs in the
 * call, so they are ready once it has answered; thrown with the states otherwise.
 */
export function assertPairsReady(params: { db: Database; seq: number; pairs: number }): void {
	const { db, seq, pairs } = params
	const states = pairStatesOf({ db, seq })
	const values = Object.values(states)
	if (values.length >= pairs && values.every((state) => state === 'ready')) return
	throw new Error(`the index pairs are not built: ${JSON.stringify(states)}`)
}

/** The rows the document's index holds, sorted; a row pointing at no record names its row number. */
export function indexRowsOf(params: { db: Database; seq: number }): IndexRow[] {
	const { db, seq } = params
	const tables = attributeIndexTablesOf({ seq })
	if (!hasTable({ db, table: tables.rows })) return []
	const rows = db.selectArrays(
		`SELECT t.text, n.text, x.value, coalesce(r.id, '#' || x.recRow) FROM ${tables.rows} x ` +
			`JOIN ${tables.names} t ON t.nid = x.tagId JOIN ${tables.names} n ON n.nid = x.nameId ` +
			`LEFT JOIN ${tables.records} r ON r.rowid = x.recRow`,
	)
	return sortRows(rows.map((row) => row.map(String) as IndexRow))
}

/**
 * The rows the index should hold, computed from the records as they are: for every registered pair, each record of
 * its tag holding an attribute of its name with a value, once per value.
 */
export function recomputedIndexRowsOf(params: { db: Database; seq: number }): IndexRow[] {
	const { db, seq } = params
	const tables = attributeIndexTablesOf({ seq })
	if (!hasTable({ db, table: tables.keys })) return []
	const pairs = db
		.selectArrays(
			`SELECT t.text, n.text FROM ${tables.keys} k JOIN ${tables.names} t ON t.nid = k.tagId ` +
				`JOIN ${tables.names} n ON n.nid = k.nameId`,
		)
		.map(([tag, name]) => [String(tag), String(name)])
	const records = db.selectArrays(`SELECT id, tagName, attributes FROM ${tables.records}`)
	const rows = new Map<string, IndexRow>()
	for (const [id, tagName, attributes] of records) {
		for (const [tag, name] of pairs) {
			if (tagName !== tag) continue
			for (const attribute of JSON.parse(String(attributes)) as AnyAttribute[]) {
				if (attribute.name !== name || typeof attribute.value !== 'string') continue
				const row: IndexRow = [tag, name, attribute.value, String(id)]
				rows.set(JSON.stringify(row), row)
			}
		}
	}
	return sortRows([...rows.values()])
}

/** The names of the document's index tables still in the file. */
export function indexTablesHeldOf(params: { db: Database; seq: number }): string[] {
	const { db, seq } = params
	const tables = attributeIndexTablesOf({ seq })
	return [tables.names, tables.rows, tables.keys].filter((table) => hasTable({ db, table }))
}

function hasTable(params: { db: Database; table: string }): boolean {
	const { db, table } = params
	return db.selectValue('SELECT 1 FROM sqlite_schema WHERE name = ?', [table]) !== undefined
}

function sortRows(rows: IndexRow[]): IndexRow[] {
	return rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}
