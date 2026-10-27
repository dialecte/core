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

/**
 * What became of a write - an import or a commit - read from the registry first, then from the
 * history: `committed` says whether a history entry carries the id (a commit is applied whole or not
 * at all, never running).
 */
export function writeOutcomeOf(params: {
	documents: readonly DocumentRecord[]
	writeId: string
	committed: boolean
}): WriteOutcome {
	const { documents, writeId, committed } = params
	const imported = importOutcomeOf({ documents, writeId })
	if (imported !== 'not-applied') return imported
	return committed ? 'applied' : 'not-applied'
}
