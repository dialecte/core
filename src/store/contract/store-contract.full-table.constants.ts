// Imports nothing on purpose: the vitest config (type-checked without the DOM) reads these names.

/** The variable that runs the full table on every leg (a release): `1` or `true`. */
export const FULL_TABLE_VARIABLE = 'STORE_CONTRACT_FULL_TABLE'

/** The values of the full-table variable that run the full table. */
export const FULL_TABLE_ON: readonly string[] = ['1', 'true']

/** The values of the full-table variable that leave the legs behind a port on their subset (empty: not set). */
export const FULL_TABLE_OFF: readonly string[] = ['', '0', 'false']
