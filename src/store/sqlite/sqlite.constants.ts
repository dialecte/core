import type { SqliteWasmText } from './sqlite.types'

/** The VFSes of sqlite-wasm the engine never uses: not installed (they would only warn where they cannot run). */
export const SQLITE_VFS_DISABLED = { opfs: true, 'opfs-vfs': true, 'opfs-wl': true } as const

/** The members of sqlite-wasm's `wasm` utilities its text codec runs through, read by `installLosslessText`. */
export const SQLITE_TEXT_MEMBERS = Object.keys({
	typedArrayToString: true,
	typedArrayPart: true,
	allocCString: true,
	alloc: true,
	heap8u: true,
} satisfies Record<keyof SqliteWasmText, true>) as (keyof SqliteWasmText)[]

/**
 * Set on a SQLite module's `wasm` utilities once `installLosslessText` made its codec lossless (registered, so every
 * copy of core reads the same mark; not enumerable, so a copy of the utilities does not carry it).
 */
export const LOSSLESS_TEXT_MARK = Symbol.for('dialecte.sqlite.losslessText')
