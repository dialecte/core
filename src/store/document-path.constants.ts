/** What a document's path puts between its folders and its file name. */
export const DOCUMENT_PATH_SEPARATOR = '/'

/** The longest folder or file name of a path, in UTF-8 bytes: what APFS, ext4 and NTFS take. */
export const DOCUMENT_PATH_SEGMENT_MAX_BYTES = 255

/** The longest path, in UTF-8 bytes: macOS's `PATH_MAX`, the tightest of the desktop systems an archive is extracted on. */
export const DOCUMENT_PATH_MAX_BYTES = 1024

/**
 * The characters a path never holds, all invisible or breaking a line in a tree: controls (Cc: U+0000-U+001F,
 * U+007F-U+009F), formats (Cf: bidi overrides and isolates, zero-width characters, the byte order mark) and line or
 * paragraph separators (Zl, Zp). A right-to-left override would show `north\u202Edcs.xml` as `northlmx.scd`.
 */
export const DOCUMENT_PATH_INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** The fields of a document's registry entry an update may change; any other key handed is ignored. */
export const DOCUMENT_UPDATE_FIELDS = ['name', 'path', 'metadata', 'status'] as const
