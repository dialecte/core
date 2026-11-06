import type { WriteOutcome } from './store.types'

/** What became of a write whose connection was lost: its outcome, or `unknown` when it could not be asked. */
export type LostWriteOutcome = WriteOutcome | 'unknown'
