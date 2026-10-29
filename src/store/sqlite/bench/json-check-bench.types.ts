/** One JSON-check bench cell: every batch checked (or copied) once per pass, the median pass kept. */
export type JsonCheckRun = {
	member: 'checkJsonValues' | 'toJsonCopy'
	/** Whether the record's values hold only Latin-1 (one-byte strings) or a character beyond it. */
	strings: JsonCheckStrings
	records: number
	batch: number
	passesMs: number[]
	medianMs: number
	nsPerRecord: number
	msPerThousandRecords: number
}

/** A cell's member: the one timed, on which strings, and how it runs over one batch. */
export type JsonCheckMember = {
	member: JsonCheckRun['member']
	strings: JsonCheckStrings
	run: (batch: unknown) => unknown
}

/** The strings a cell's records hold: Latin-1 only, or one character beyond it in every value. */
export type JsonCheckStrings = 'one-byte' | 'two-byte'
