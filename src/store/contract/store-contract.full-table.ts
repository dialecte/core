import {
	FULL_TABLE_OFF,
	FULL_TABLE_ON,
	FULL_TABLE_VARIABLE,
} from './store-contract.full-table.constants'

/**
 * Whether the full table runs on every leg: the variable set to `1` or `true`; empty, absent, `0` or `false` is not.
 * Any other value is refused: a typo never runs the subset silently.
 */
export function isFullTable(params: { value: string | undefined }): boolean {
	const { value = '' } = params
	if (FULL_TABLE_ON.includes(value)) return true
	if (FULL_TABLE_OFF.includes(value)) return false
	const accepted = [...FULL_TABLE_ON, ...FULL_TABLE_OFF].map((known) => `'${known}'`).join(', ')
	throw new Error(`${FULL_TABLE_VARIABLE}=${value}: expected one of ${accepted}`)
}
