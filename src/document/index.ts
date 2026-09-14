export { Document } from './document'
export { bindExtensions } from './bind-extensions'
export { createStagedOperations } from './staged-operations'
export * from './query'
export * from './transaction'

export type { ProgressReporter, DocumentProgress } from './progress'

export type {
	ExtendedDocument,
	Context,
	CachedContext,
	StagedOperations,
	PreparedTransaction,
	DocumentState,
	TransactionEntry,
} from './types'

export type * from './types.extensions'
export type * from './types.ref'
