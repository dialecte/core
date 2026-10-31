import type { WriteOutcome } from './store.types'
import type { DocumentRecord } from '@/project/types'

/**
 * What became of an import, read from the registry: the document its `writeId` is on is `running`
 * while `importing`, `applied` once `ready`; no document carries it after a failure, an abort or a
 * removal - `not-applied`. A store that knows which imports run says so (`isRunning`): a document
 * `importing` whose import does not run is what a failed import left when its removal failed too -
 * `not-applied`, removed when a store of the project next opens.
 */
export function importOutcomeOf(params: {
	documents: readonly DocumentRecord[]
	writeId: string
	isRunning?: (params: { writeId: string }) => boolean
}): WriteOutcome {
	const { documents, writeId, isRunning } = params
	const document = documents.find((candidate) => candidate.writeId === writeId)
	if (!document) return 'not-applied'
	if (document.status !== 'importing') return 'applied'
	return isRunning?.({ writeId }) === false ? 'not-applied' : 'running'
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
	isRunning?: (params: { writeId: string }) => boolean
}): WriteOutcome {
	const { documents, writeId, committed, isRunning } = params
	const imported = importOutcomeOf({ documents, writeId, isRunning })
	if (imported !== 'not-applied') return imported
	return committed ? 'applied' : 'not-applied'
}
