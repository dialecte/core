/** A document's path read apart: the folders it sits in, outermost first, then its file name. */
export type DocumentPathParts = {
	folders: string[]
	fileName: string
}
