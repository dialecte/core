/** A document's path read apart: the folders it sits in, outermost first, then its file name. */
export type DocumentPathParts = {
	folders: string[]
	fileName: string
}

/** A registered document as the clash check reads it: its id and, when it has one, its path. */
export type PathHolderCandidate = {
	id: string
	path?: string
}
