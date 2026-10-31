/** A module the test-entry scan reads in its own test: functions naming a non-exported type only through a generic. */

// not re-exported by this module: a consumer of it could not name the type
import type { HiddenRow } from './test-entry-scan.types'

export function listHiddenRows(): HiddenRow[] {
	return []
}

export async function loadHiddenRow(): Promise<HiddenRow> {
	return { value: '' }
}

export function indexHiddenRows(): Record<string, HiddenRow> {
	return {}
}
