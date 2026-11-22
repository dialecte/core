import { expect } from 'vitest'

import type { VersionTrail } from './read-model-harness.types'

/**
 * Asserts a cached answer is a snapshot: equal to one of the uncached answers the trail recorded from point `from` (the
 * session's start) on. Whether a later read moved on is the case's own next assertion.
 *
 * @intent assert a cached read answers a moment of its session
 */
export function expectSnapshot<GenericAnswer>(params: {
	answer: GenericAnswer
	trail: VersionTrail<GenericAnswer>
	from: number
}): void {
	const { answer, trail, from } = params
	expect(trail.answers.slice(from)).toContainEqual(answer)
}
