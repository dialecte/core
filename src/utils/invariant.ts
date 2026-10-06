import { throwDialecteError } from '@/errors'

import type { DialecteErrorDefinition, DialecteErrorKey } from '@/errors'

/**
 * Assert a condition, throwing a structured DialecteError if it fails.
 *
 * `key` is a key of the core catalogue or an error a dialecte declared with `defineErrors`;
 * `meta` says what the error is about, as data a consumer can build its own wording from.
 *
 * @example
 * invariant(record, { detail: 'addChild: parent not found' })
 * invariant(ref.id, { detail: 'Singleton element has no id', key: 'ELEMENT_NOT_FOUND' })
 */
export function invariant(
	condition: unknown,
	error: {
		detail: string
		key?: DialecteErrorKey | DialecteErrorDefinition
		ref?: { tagName: string; id?: string }
		meta?: Record<string, unknown>
	},
): asserts condition {
	if (condition) return
	const { detail, key = 'ASSERTION_FAILED', ref, meta } = error
	throwDialecteError(key, { detail, ref, meta })
}
