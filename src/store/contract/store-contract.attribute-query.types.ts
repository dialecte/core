import type { AnyRawRecord } from '@/types'

/** Stage one write: a create or a delete of `record`, an update from the held version to `record`. */
export type Stager = (params: {
	status: 'created' | 'updated' | 'deleted'
	record: AnyRawRecord
}) => void

/** What a case stages in its transaction, on a context over the store. */
export type Staging = (stage: Stager) => void

/** An answer as a case compares it: each record's id and status, in the order answered. */
export type Answer = string[]
