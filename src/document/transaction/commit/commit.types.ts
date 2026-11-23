import type { CommitChanges, UnknownCommitChanges } from '@/project/types'
import type { StoreVersion } from '@/store/store.types'

/** What a transaction's commit changed, and the version its store answered for it (none: a store keeping none, or a commit whose answer was lost). */
export type CommittedTransaction = {
	changes: CommitChanges | UnknownCommitChanges
	version: StoreVersion | undefined
}
