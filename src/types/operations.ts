import type { AnyDialecteConfig, ElementsOf } from './dialecte-config'
import type { RawRecord } from './records'

/**
 * Operation status for tracking element lifecycle
 */
export type OperationStatus = 'created' | 'updated' | 'deleted' | 'unchanged'

/**
 * Staged operation - tracks changes before commit
 */
export type Operation<GenericConfig extends AnyDialecteConfig> =
	| {
			status: 'created'
			oldRecord: undefined
			newRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	  }
	| {
			status: 'updated'
			oldRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
			newRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	  }
	| {
			status: 'deleted'
			oldRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
			newRecord: undefined
	  }

/**
 * Generic operation for contexts where specific dialecte is not known
 */
export type AnyOperation = Operation<AnyDialecteConfig>
