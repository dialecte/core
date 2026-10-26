import { createInMemoryState } from './in-memory-state'

import type { ReadonlyInMemoryState } from './types'
import type { AnyRawRecord } from '@/types'

/** What a document that is not in the store reads as: no records. */
export const EMPTY_TABLE: ReadonlyMap<string, AnyRawRecord> = new Map()

/** What a name with no state reads as, and all a placeholder store ever reads: nothing. */
export const EMPTY_STATE: ReadonlyInMemoryState = createInMemoryState()
