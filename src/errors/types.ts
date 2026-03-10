import type { ERROR_CATALOG } from './codes'

export type DialecteErrorKey = keyof typeof ERROR_CATALOG
export type DialecteErrorCode = (typeof ERROR_CATALOG)[DialecteErrorKey]['code']

/**
 * Structured error — serializable, worker-safe, UI-consumable.
 * Original Error goes in `cause` to preserve stack trace.
 */
export type DialecteError = {
	code: DialecteErrorCode
	key: DialecteErrorKey
	message: string // UI-consumable (toast)
	detail: string // developer-consumable (console)
	method: string // which operation failed
	ref?: { tagName: string; id: string }
	cause?: Error
}
