import type { DocumentRecord } from '@/project/types'

/** How often an import says it is still alive, through `DocumentRecord.importingAt`. */
export const IMPORT_HEARTBEAT_MS = 2_000

/**
 * An import whose last heartbeat is older than this was left by a realm that died (a tab closed
 * mid-import): `open()` removes it. Generous on purpose - a false "dead" loses a running import, a
 * false "alive" only keeps a hidden leftover a few minutes longer: a hidden tab's timers are
 * throttled to once a minute by the browser, and a dialecte's `afterImport` on a very large file
 * may hold the main thread for tens of seconds.
 */
export const STALE_IMPORT_MS = 5 * 60_000

/** A document whose records are still being stored - by this realm or another one. */
export function isImporting(record: DocumentRecord): boolean {
	return record.status === 'importing'
}

/** An import nobody is running any more: still `importing`, its heartbeat long gone. */
export function isStaleImport(record: DocumentRecord, now = Date.now()): boolean {
	return isImporting(record) && now - (record.importingAt ?? 0) > STALE_IMPORT_MS
}

/** The documents a project opens, lists and serves: nothing half-imported is ever visible. */
export function openableDocuments(records: readonly DocumentRecord[]): DocumentRecord[] {
	return records.filter((record) => !isImporting(record))
}
