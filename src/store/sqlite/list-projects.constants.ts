/** What a SQLite database file starts with: its magic string, and where its header keeps the layout version. */
export const SQLITE_FILE_HEADER = {
	magic: 'SQLite format 3\0',
	/** `PRAGMA user_version`: 4 bytes, big-endian. */
	userVersionOffset: 60,
	bytes: 100,
} as const

/** How often a pool file the browser refuses to read (its engine writing) is read again before it is listed `unknown`. */
export const LISTING_READ_ATTEMPTS = 3

/** The wait between two reads of a pool file the browser refused. */
export const LISTING_READ_RETRY_MS = 50
