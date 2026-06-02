/**
 * Shared table naming and schema constants for all Store implementations.
 *
 * These define the logical storage layout regardless of backend
 * (DexieStore, SQLiteStore, InMemoryStore, etc.).
 */

import type { RecordSchema } from './store.types'

// --- Table names ---

/** System table: file registry */
export const TABLE_DOCUMENTS = '_documents'

/** System table: per-file changelog entries */
export const TABLE_CHANGELOG = '_changeLog'

/** System table: metadata (schema version, per-file heads) */
export const TABLE_META = '_meta'

/** Prefix for per-file record tables */
export const TABLE_RECORD_PREFIX = 'xel_'

/** Derive the record table name for a given documentId */
export function recordTableName(documentId: string): string {
	return `${TABLE_RECORD_PREFIX}${documentId}`
}

/** System table: blob metadata registry */
export const TABLE_BLOBS = '_blobs'

/** Prefix for per-document blob data tables */
export const TABLE_BLOB_PREFIX = 'blob_'

/** Derive the blob data table name for a given documentId */
export function blobTableName(documentId: string): string {
	return `${TABLE_BLOB_PREFIX}${documentId}`
}

// --- System table schemas (backend-agnostic) ---

/** Schema for the _files registry table */
export const DOCUMENTS_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['name', 'configKey'],
	compoundIndexes: [],
	arrayIndexes: [],
}

/** Schema for the _changeLog table */
export const CHANGELOG_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	autoIncrement: true,
	indexes: ['documentId'],
	compoundIndexes: [['documentId', 'sequenceNumber']],
	arrayIndexes: [],
}

/** Schema for the _meta table */
export const META_SCHEMA: RecordSchema = {
	primaryKey: 'key',
	indexes: [],
	compoundIndexes: [],
	arrayIndexes: [],
}

/** Schema for the _blobs registry table. `documentId` indexed for cascade cleanup. */
export const BLOBS_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['documentId'],
	compoundIndexes: [],
	arrayIndexes: [],
}

/** Schema for the per-document blob data tables (`blob_{documentId}`). */
export const BLOB_DATA_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: [],
	compoundIndexes: [],
	arrayIndexes: [],
}
