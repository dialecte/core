import { throwDialecteError } from '@/errors'

import type { DialecteErrorKey } from '@/errors'

/**
 * Assert a condition, throwing a structured DialecteError if it fails.
 *
 * @example
 * assert(record, { detail: 'addChild: parent not found', method: 'addChild' })
 * assert(ref.id, { detail: 'Singleton element has no id', method: 'getRecord', key: 'ELEMENT_NOT_FOUND' })
 */
export function assert(
	condition: unknown,
	error: {
		detail: string
		method: string
		key?: DialecteErrorKey
		ref?: { tagName: string; id?: string }
	},
): asserts condition {
	if (condition) return
	const { detail, method, key = 'ASSERTION_FAILED', ref } = error
	throwDialecteError(key, { detail, method, ref })
}
