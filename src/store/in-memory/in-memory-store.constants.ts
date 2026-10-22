import type { AnyRawRecord } from '@/types'

/** What a document that is not in the store reads as: no records. */
export const EMPTY_TABLE: ReadonlyMap<string, AnyRawRecord> = new Map()
