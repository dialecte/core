/**
 * BlobRecord — registry entry for a binary attachment stored alongside XML documents.
 *
 * The binary data lives in a partitioned table `blob_{documentId}` (storage owner).
 * `attachedTo` describes logical references from XML records; the array is independent
 * of the storage owner and may include zero (standalone), one, or many references.
 */
export type BlobAttachment = {
	/** The XML document this blob is referenced from */
	documentId: string
	/** Record id (e.g. element uuid) inside that document */
	recordRef: string
	/** Optional attribute name on the record where the filename is referenced */
	attribute?: string
}

export type BlobRecord = {
	/** Blob identifier (crypto.randomUUID()) */
	id: string
	/** Storage owner: binary data lives in `blob_{documentId}` */
	documentId: string
	/** Original filename (e.g. "diagram.pdf") */
	name: string
	/** MIME type (e.g. "application/pdf") */
	mimeType?: string
	/** Size in bytes, for UI display without loading data */
	size?: number
	/** Creation timestamp (ms since epoch) */
	createdAt: number
	/**
	 * Logical references from XML records.
	 * Empty array = standalone project blob (not linked to any XML record).
	 */
	attachedTo: BlobAttachment[]
}
