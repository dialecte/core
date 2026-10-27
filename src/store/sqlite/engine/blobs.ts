import { TABLE_BLOB_DATA } from './engine.constants'

import { compareById } from '@/store/compare-by-id'
import { TABLE_BLOBS } from '@/store/store.constants'

import type { BlobRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * The blobs of a project on the file: each entry in the blob registry (by id, with its owner document,
 * the entry as JSON), its bytes and their type apart, so a list never reads bytes. Writes run in the
 * caller's transaction.
 */

/** A blob written whole: its entry (already checked as JSON values) and its bytes, over any of that id. */
export function writeBlob(params: {
	db: Database
	entry: BlobRecord
	type: string
	bytes: Uint8Array
}): void {
	const { db, entry, type, bytes } = params
	db.exec({
		sql: `INSERT OR REPLACE INTO ${TABLE_BLOBS} (id, documentId, entry) VALUES (?, ?, ?)`,
		bind: [entry.id, entry.documentId, JSON.stringify(entry)],
	})
	db.exec({
		sql: `INSERT OR REPLACE INTO ${TABLE_BLOB_DATA} (id, type, bytes) VALUES (?, ?, ?)`,
		bind: [entry.id, type, bytes],
	})
}

/** A blob's entry and its bytes with their type; none for an unknown id. */
export function readBlob(params: {
	db: Database
	blobId: string
}): { entry: BlobRecord; type: string; bytes: Uint8Array } | undefined {
	const { db, blobId } = params
	const [row] = db.selectArrays(
		`SELECT b.entry, d.type, d.bytes FROM ${TABLE_BLOBS} b JOIN ${TABLE_BLOB_DATA} d ON d.id = b.id WHERE b.id = ?`,
		[blobId],
	)
	if (!row) return undefined
	const [entry, type, bytes] = row
	return {
		entry: JSON.parse(String(entry)) as BlobRecord,
		type: String(type),
		bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(),
	}
}

/** A blob's entry alone; none for an unknown id. */
export function readBlobEntry(params: { db: Database; blobId: string }): BlobRecord | undefined {
	const { db, blobId } = params
	const entry = db.selectValue(`SELECT entry FROM ${TABLE_BLOBS} WHERE id = ?`, [blobId])
	return entry === undefined ? undefined : (JSON.parse(String(entry)) as BlobRecord)
}

/** A blob's entry written over, its bytes kept. */
export function writeBlobEntry(params: { db: Database; entry: BlobRecord }): void {
	const { db, entry } = params
	db.exec({
		sql: `UPDATE ${TABLE_BLOBS} SET entry = ? WHERE id = ?`,
		bind: [JSON.stringify(entry), entry.id],
	})
}

/**
 * The entries a filter of their references keeps, in id order: attached to the document (`documentId`),
 * to the record of it (`recordRef` too), or to nothing (`standalone`).
 */
export function readBlobEntries(params: {
	db: Database
	filter: { documentId: string; recordRef?: string } | 'standalone'
}): BlobRecord[] {
	const { db, filter } = params
	const rows =
		filter === 'standalone'
			? db.selectValues(
					`SELECT entry FROM ${TABLE_BLOBS} WHERE json_array_length(entry, '$.attachedTo') = 0`,
				)
			: db.selectValues(
					`SELECT entry FROM ${TABLE_BLOBS} b WHERE EXISTS (SELECT 1 FROM json_each(b.entry, '$.attachedTo') a ` +
						`WHERE a.value->>'documentId' = ? AND (? IS NULL OR a.value->>'recordRef' = ?))`,
					[filter.documentId, filter.recordRef ?? null, filter.recordRef ?? null],
				)
	return rows.map((entry) => JSON.parse(String(entry)) as BlobRecord).sort(compareById)
}

/** A blob gone, entry and bytes; an unknown id is ignored. */
export function deleteBlob(params: { db: Database; blobId: string }): void {
	const { db, blobId } = params
	db.exec({ sql: `DELETE FROM ${TABLE_BLOB_DATA} WHERE id = ?`, bind: [blobId] })
	db.exec({ sql: `DELETE FROM ${TABLE_BLOBS} WHERE id = ?`, bind: [blobId] })
}

/** The blobs a document owns gone, entries and bytes; the blobs only attached to it stay. */
export function deleteBlobsOf(params: { db: Database; documentId: string }): void {
	const { db, documentId } = params
	db.exec({
		sql: `DELETE FROM ${TABLE_BLOB_DATA} WHERE id IN (SELECT id FROM ${TABLE_BLOBS} WHERE documentId = ?)`,
		bind: [documentId],
	})
	db.exec({ sql: `DELETE FROM ${TABLE_BLOBS} WHERE documentId = ?`, bind: [documentId] })
}
