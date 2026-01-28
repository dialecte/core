/**
 * Options for chunking during import/export
 */
export type ChunkOptions = {
	batchSize: number
	chunkSize: number
}

/**
 * Options for importing XML files
 */
export type ImportOptions = ChunkOptions & {
	useBrowserApi: boolean
}

export type ExportOptions = {
	useBrowserApi: boolean
}
