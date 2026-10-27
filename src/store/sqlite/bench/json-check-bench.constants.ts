/**
 * The JSON-check bench's records, shaped like the composed 50 MB compact file's (a sax scan of it:
 * 486,333 records, 1.67 attributes and one child per record on average, a text value on a quarter of
 * them, 16 characters long).
 */
export const JSON_CHECK_BENCH_RECORDS = 486_333

/** Timed passes over every batch, after one untimed warm-up pass; the median is reported. */
export const JSON_CHECK_BENCH_PASSES = 7

/**
 * Attributes per record, in turn: the file's histogram in 30 slots (20 % none, a third one, 27 % two,
 * 10 % three, then one each of 4, 5 and 6), a mean of 1.67.
 */
export const JSON_CHECK_BENCH_ATTRIBUTE_COUNTS = [
	1, 2, 0, 1, 2, 1, 3, 0, 2, 1, 4, 0, 1, 2, 1, 3, 0, 2, 1, 5, 0, 1, 2, 1, 3, 2, 1, 0, 2, 6,
] as const

/** One record in this many holds a text value. */
export const JSON_CHECK_BENCH_TEXT_EVERY = 4

/** The text value: the file's mean length. */
export const JSON_CHECK_BENCH_TEXT = 'a text value 16c'
