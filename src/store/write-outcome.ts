import type { WriteOutcome } from './store.types'
import type { DocumentRecord } from '@/project/types'

/**
 * What became of an import, read from the registry: the document its `writeId` is on is `running`
 * while `importing`, `applied` once `ready`; no document carries it after a failure, an abort or a
 * removal - `not-applied`.
 */
export function importOutcomeOf(params: {
	documents: readonly DocumentRecord[]
	writeId: string
}): WriteOutcome {
	const { documents, writeId } = params
	const document = documents.find((candidate) => candidate.writeId === writeId)
	if (!document) return 'not-applied'
	return document.status === 'importing' ? 'running' : 'applied'
}
