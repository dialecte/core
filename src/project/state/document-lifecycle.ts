import type { DocumentRecord } from '@/project/types'

/** A document whose records are still being stored - by this realm or another one. */
export function isImporting(record: DocumentRecord): boolean {
	return record.status === 'importing'
}

/** The documents a project opens, lists and serves: nothing half-imported is ever visible. */
export function openableDocuments(records: readonly DocumentRecord[]): DocumentRecord[] {
	return records.filter((record) => !isImporting(record))
}
