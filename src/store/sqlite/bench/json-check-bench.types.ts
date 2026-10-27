/** One JSON-check bench cell: every batch checked (or copied) once per pass, the median pass kept. */
export type JsonCheckRun = {
	member: 'checkJsonValues' | 'toJsonCopy'
	records: number
	batch: number
	passesMs: number[]
	medianMs: number
	nsPerRecord: number
	msPerThousandRecords: number
}
