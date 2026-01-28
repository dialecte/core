import type { AnyDialecteConfig, ElementsOf } from './dialecte-config'
import type { Operation } from './operations'
import type { ChainRecord } from './records'

/**
 * Context carries the state through the promise chain
 * Each operation returns a new builder with updated context
 */
export type Context<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	currentFocus: ChainRecord<GenericConfig, GenericElement>
	stagedOperations: Operation<GenericConfig>[]
}

/**
 * Generic context for situations where element type is not yet known
 */
export type AnyContext = Context<AnyDialecteConfig, ElementsOf<AnyDialecteConfig>>
