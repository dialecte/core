import type { ERROR_CATALOG } from './codes'
import type { AnyDialecteConfig, ChainRecord, ElementsOf, Operation } from '@/types'

export type DialecteErrorKey = keyof typeof ERROR_CATALOG
export type DialecteErrorCode = (typeof ERROR_CATALOG)[DialecteErrorKey]['code']

/**
 * Standard error context that all errors should include
 */
export type DialecteErrorContext<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> = {
	method?: string
	currentFocus?: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	operations?: Operation<GenericConfig>[]
	[key: string]: any // Allow additional context properties
}

/**
 * Core error type with code, default message, and context
 */
export type DialecteCoreError<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> =
	Error & {
		code: DialecteErrorCode
		errorKey: DialecteErrorKey
		defaultMessage: string
		context?: DialecteErrorContext<GenericConfig>
	}
