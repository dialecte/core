/** The bytes of a UUID: 128 bits. */
export const UUID_BYTE_COUNT = 16

/** Where a UUID's text puts its dashes: after these byte positions. */
export const UUID_DASH_AFTER_BYTES: ReadonlySet<number> = new Set([3, 5, 7, 9])
