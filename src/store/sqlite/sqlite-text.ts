import { LOSSLESS_TEXT_MARK, SQLITE_TEXT_MEMBERS } from './sqlite.constants'

import { createDialecteError } from '@/errors'

import type { SqliteCString, SqliteWasmText } from './sqlite.types'
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Make sqlite-wasm's text codec keep well-formed text as written, once per SQLite module. Its own
 * reads a text column with a default `TextDecoder`, which drops a leading byte order mark, and
 * binds a string with a `TextEncoder`, which writes a lone surrogate as U+FFFD - so a key holding
 * one would name the row whose key holds U+FFFD there. Installed: a column is decoded with the byte
 * order mark kept, and a string that is not well-formed is bound as WTF-8 (a lone surrogate as its
 * own three bytes, as SQLite's JSON reader decodes an escaped one), bytes UTF-8 never holds: such a
 * key never matches text written as UTF-8 (the key holding U+FFFD in its place among them). A
 * well-formed string is bound as before. Error messages, column names and file names go through
 * sqlite-wasm's own decoder and allocator, unchanged.
 */
export function installLosslessText(params: { sqlite3: Sqlite3Static }): void {
	const { sqlite3 } = params
	if (isLosslessTextInstalled({ sqlite3 })) return
	const wasm = textMembersOf({ sqlite3 })
	const keepingDecoder = new TextDecoder('utf-8', { ignoreBOM: true })
	const allocUtf8 = wasm.allocCString
	const replacements: Pick<SqliteWasmText, 'typedArrayToString' | 'allocCString'> = {
		typedArrayToString: function decodeKeepingByteOrderMark(array, begin, end) {
			return keepingDecoder.decode(wasm.typedArrayPart(array, begin, end))
		},
		allocCString: function allocLosslessCString(text, returnWithLength) {
			if (typeof text !== 'string' || text.isWellFormed()) return allocUtf8(text, returnWithLength)
			return allocBytes({ wasm, bytes: wtf8Bytes({ text }), returnWithLength })
		},
	}
	Object.assign(sqlite3.wasm, replacements)
	// on the module itself: every copy of core handed this module sees the install
	Object.defineProperty(sqlite3.wasm, LOSSLESS_TEXT_MARK, { value: true })
}

/** Whether `installLosslessText` ran on this SQLite module. */
export function isLosslessTextInstalled(params: { sqlite3: Sqlite3Static }): boolean {
	return (params.sqlite3.wasm as unknown as Record<symbol, unknown>)[LOSSLESS_TEXT_MARK] === true
}

/**
 * A text's bytes in WTF-8: UTF-8, a lone surrogate written as its own three bytes (`ED A0 80` ..
 * `ED BF BF`) where UTF-8 has no form for it.
 */
function wtf8Bytes(params: { text: string }): Uint8Array {
	const { text } = params
	const bytes: number[] = []
	for (let index = 0; index < text.length; index++) {
		const codePoint = text.codePointAt(index)!
		if (codePoint < 0x80) bytes.push(codePoint)
		else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
		else if (codePoint < 0x10000) {
			bytes.push(
				0xe0 | (codePoint >> 12),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			)
		} else {
			bytes.push(
				0xf0 | (codePoint >> 18),
				0x80 | ((codePoint >> 12) & 0x3f),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			)
			// the low half of the pair is in this code point
			index++
		}
	}
	return Uint8Array.from(bytes)
}

/** The members the install reads and replaces, each a function, else `ASSERTION_FAILED`. */
function textMembersOf(params: { sqlite3: Sqlite3Static }): SqliteWasmText {
	const { sqlite3 } = params
	const wasm = sqlite3.wasm as unknown as Record<string, unknown>
	const missing = SQLITE_TEXT_MEMBERS.filter(function isMissing(member) {
		return typeof wasm[member] !== 'function'
	})
	if (missing.length > 0) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `sqlite-wasm's wasm utilities lack ${missing.join(', ')} (SQLite ${sqlite3.version?.libVersion ?? 'unknown'}): not the sqlite-wasm build core pins, its text codec cannot be made lossless`,
		})
	}
	return wasm as unknown as SqliteWasmText
}

/** `bytes` copied into the heap behind a NUL, as `allocCString` answers a string it allocated. */
function allocBytes(params: {
	wasm: SqliteWasmText
	bytes: Uint8Array
	returnWithLength?: boolean
}): SqliteCString {
	const { wasm, bytes, returnWithLength } = params
	const pointer = wasm.alloc(bytes.length + 1)
	// read after the allocation: the heap may have grown
	const heap = wasm.heap8u()
	heap.set(bytes, pointer)
	heap[pointer + bytes.length] = 0
	return returnWithLength ? [pointer, bytes.length] : pointer
}
