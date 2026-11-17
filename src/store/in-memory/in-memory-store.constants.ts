import { createInMemoryState } from './in-memory-state'
import { createRecordTable } from './in-memory-table'

import type { ReadonlyInMemoryState, ReadonlyRecordTable } from './types'

/** What a document that is not in the store reads as: no records. */
export const EMPTY_TABLE: ReadonlyRecordTable = createRecordTable()

/** What a name with no state reads as, and all a placeholder store ever reads: nothing. */
export const EMPTY_STATE: ReadonlyInMemoryState = createInMemoryState()
