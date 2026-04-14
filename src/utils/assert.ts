import { throwDialecteError } from '@/errors'

import type { DialecteErrorKey } from '@/errors'

/**
 * Assert a condition, throwing a structured DialecteError if it fails.
 *
 * @example
 * invariant(record, { detail: 'addChild: parent not found' })
 * invariant(ref.id, { detail: 'Singleton element has no id', key: 'ELEMENT_NOT_FOUND' })
 */
export function invariant(
	condition: unknown,
	error: {
		detail: string
		key?: DialecteErrorKey
		ref?: { tagName: string; id?: string }
	},
): asserts condition {
	if (condition) return
	const { detail, key = 'ASSERTION_FAILED', ref } = error
	throwDialecteError(key, { detail, ref })
}
