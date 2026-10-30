import { UNCONSTRAINED } from './child-occurrences.constants'
import { occurrencesOf } from './particle-occurrences'

import type { ChildOccurrences } from './child-occurrences.types'
import type { ContentDefinition } from '@/types'

export type { ChildOccurrences } from './child-occurrences.types'

/**
 * How often each child may appear under an element, read from its resolved definition (`resolveDefinition`,
 * or `query.getDefinition`): per child in `children.sequence` order, `{ min, max }` with `max` undefined for
 * unbounded. An absent `minOccurs` is 0 and an absent `maxOccurs` unbounded, as the generator writes them; a
 * sequence adds what its particles allow, a choice keeps the widest of its branches (0 when a branch lacks the
 * child), a group's own occurrences multiply what it holds. A child the content model does not name (no model,
 * or one only a variant holds) is optional and unbounded.
 *
 * @intent how many times a child may appear, required or optional children of an element, cardinality of children
 */
export function childOccurrences(params: {
	definition: Pick<ContentDefinition, 'children' | 'contentModel'>
}): Readonly<Record<string, ChildOccurrences>> {
	const { children, contentModel } = params.definition
	const named = contentModel ? occurrencesOf(contentModel) : new Map<string, ChildOccurrences>()
	return Object.fromEntries(
		children.sequence.map((tagName) => [tagName, named.get(tagName) ?? UNCONSTRAINED]),
	)
}
