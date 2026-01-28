import type { AnyRawRecord } from '@/types'

export type ExpectedRecord = Pick<AnyRawRecord, 'id' | 'tagName'> & Partial<AnyRawRecord>
export type ExpectedRecords = Array<ExpectedRecord>
